import { listProjectItems, readProjectRuntimeState, recordProjectRuntimeActivity } from "@effect-template/lib"
import type { ProjectItem } from "@effect-template/lib/usecases/projects"
import { Duration, Effect, Match, Schedule } from "effect"

import { activeAgents } from "./container-tasks-core.js"
import { readContainerTaskSnapshot } from "./container-tasks.js"
import { hasLiveProjectBrowserSession } from "./project-browser.js"
import { decideProjectIdleAction } from "./project-idle-policy.js"
import { applyProjectResourceProfile, suspendProjectRuntime } from "./project-lifecycle-resources.js"
import { loadProjectRuntimeByProject, runtimeForProject } from "./project-runtime.js"
import { hasLiveProjectSkillerSession } from "./skiller.js"
import { hasLiveProjectTerminalSession } from "./terminal-sessions.js"

export type ProjectAutoSuspendConfig = {
  readonly enabled: boolean
  readonly idleTimeoutMs: number
  readonly scanIntervalMs: number
  readonly throttleInteractiveIdle: boolean
  readonly interactiveIdleCpuFactor: number
}

const minuteMs = 60_000
const secondMs = 1_000
const defaultIdleTimeoutMinutes = 30
const defaultScanIntervalSeconds = 60
const defaultInteractiveIdleCpuFactor = 0.5

const parsePositiveIntegerEnv = (
  key: string,
  defaultValue: number
): number => {
  const parsed = Number.parseInt(process.env[key] ?? "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue
}

const parsePositiveFractionEnv = (
  key: string,
  defaultValue: number
): number => {
  const parsed = Number(process.env[key] ?? "")
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : defaultValue
}

const parseEnabledEnv = (
  key: string,
  defaultValue: boolean
): boolean => {
  const raw = process.env[key]?.trim().toLowerCase()
  if (raw === undefined || raw.length === 0) {
    return defaultValue
  }
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no"
}

export const resolveProjectAutoSuspendConfig = (): ProjectAutoSuspendConfig => ({
  enabled: parseEnabledEnv("DOCKER_GIT_AUTO_SUSPEND", true),
  idleTimeoutMs: parsePositiveIntegerEnv("DOCKER_GIT_AGENT_IDLE_TIMEOUT_MINUTES", defaultIdleTimeoutMinutes) * minuteMs,
  scanIntervalMs: parsePositiveIntegerEnv("DOCKER_GIT_IDLE_SCAN_INTERVAL_SECONDS", defaultScanIntervalSeconds) * secondMs,
  throttleInteractiveIdle: parseEnabledEnv("DOCKER_GIT_INTERACTIVE_IDLE_THROTTLE", true),
  interactiveIdleCpuFactor: parsePositiveFractionEnv(
    "DOCKER_GIT_INTERACTIVE_IDLE_CPU_FACTOR",
    defaultInteractiveIdleCpuFactor
  )
})

const snapshotHasAgentTask = (
  project: ProjectItem
) =>
  readContainerTaskSnapshot(project.projectDir, false).pipe(
    Effect.map((snapshot) =>
      activeAgents(snapshot.agents).length > 0 || snapshot.tasks.some((task) => task.kind === "agent")
    ),
    Effect.catchAll(() => Effect.succeed(false))
  )

const projectHasActiveAgent = (
  project: ProjectItem
) =>
  snapshotHasAgentTask(project)

const projectHasLiveInteractiveSession = (
  project: ProjectItem,
  sshSessions: number
): boolean =>
  sshSessions > 0 ||
  hasLiveProjectTerminalSession(project.projectDir) ||
  hasLiveProjectBrowserSession(project.projectDir) ||
  hasLiveProjectSkillerSession(project.projectDir)

const runProjectIdleDecision = (
  project: ProjectItem,
  config: ProjectAutoSuspendConfig,
  running: boolean,
  sshSessions: number,
  startedAtEpochMs: number | null
) =>
  Effect.gen(function*(_) {
    const runtimeState = yield* _(readProjectRuntimeState(project.projectDir))
    const activeAgent = yield* _(projectHasActiveAgent(project))
    const liveInteractive = projectHasLiveInteractiveSession(project, sshSessions)
    const decision = decideProjectIdleAction(
      {
        hasActiveAgent: activeAgent,
        hasLiveInteractiveSession: liveInteractive,
        lastAgentSeenAtEpochMs: runtimeState.lastAgentSeenAtEpochMs,
        lastInteractiveSeenAtEpochMs: runtimeState.lastInteractiveSeenAtEpochMs,
        resourceProfile: runtimeState.resourceProfile,
        running,
        startedAtEpochMs
      },
      {
        agentIdleTimeoutMs: config.idleTimeoutMs,
        nowEpochMs: Date.now()
      }
    )

    return yield* _(
      Match.value(decision).pipe(
        Match.when({ _tag: "IgnoreStopped" }, () => Effect.void),
        Match.when({ _tag: "KeepRunning" }, () =>
          activeAgent
            ? recordProjectRuntimeActivity(project.projectDir, "agent").pipe(Effect.asVoid)
            : Effect.void),
        Match.when({ _tag: "RestoreNormalResources" }, () =>
          recordProjectRuntimeActivity(project.projectDir, "agent").pipe(
            Effect.zipRight(applyProjectResourceProfile(project, "normal", config.interactiveIdleCpuFactor))
          )),
        Match.when({ _tag: "ThrottleInteractiveIdle" }, () =>
          config.throttleInteractiveIdle
            ? applyProjectResourceProfile(
              project,
              "interactive-idle-throttled",
              config.interactiveIdleCpuFactor
            )
            : Effect.void),
        Match.when({ _tag: "SuspendIdle" }, () =>
          suspendProjectRuntime(project, "auto-suspend")),
        Match.exhaustive
      )
    )
  }).pipe(
    Effect.catchAll((error) =>
      Effect.logWarning(
        `[auto-suspend] Failed to evaluate ${project.containerName}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    )
  )

export const scanProjectAutoSuspend = (
  config: ProjectAutoSuspendConfig
) =>
  Effect.gen(function*(_) {
    if (!config.enabled) {
      return
    }
    const projects = yield* _(listProjectItems)
    const runtimeByProject = yield* _(loadProjectRuntimeByProject(projects))
    yield* _(
      Effect.forEach(
        projects,
        (project) => {
          const runtime = runtimeForProject(runtimeByProject, project)
          return runProjectIdleDecision(
            project,
            config,
            runtime.running,
            runtime.sshSessions,
            runtime.startedAtEpochMs ?? project.lastStartedAtEpochMs
          )
        },
        { concurrency: 2, discard: true }
      )
    )
  }).pipe(
    Effect.catchAll((error) =>
      Effect.logWarning(
        `[auto-suspend] Scan failed: ${error instanceof Error ? error.message : String(error)}`
      )
    )
  )

export const startProjectAutoSuspendLoop = (
  config: ProjectAutoSuspendConfig
) =>
  config.enabled
    ? scanProjectAutoSuspend(config).pipe(
      Effect.repeat(Schedule.addDelay(Schedule.forever, () => Duration.millis(config.scanIntervalMs)))
    )
    : Effect.log("docker-git auto-suspend disabled.")
