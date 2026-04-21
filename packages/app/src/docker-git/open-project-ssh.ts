import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Duration, Effect } from "effect"

import { createProjectTerminalSession, upProject } from "./api-client.js"
import type { ApiTerminalSession } from "./api-terminal-codec.js"
import { type ControllerRuntime, isRemoteDockerHost } from "./controller.js"
import { runCommandWithExitCodes } from "./frontend-lib/shell/command-runner.js"
import { CommandFailedError } from "./frontend-lib/shell/errors.js"
import { withPreservedTerminalState } from "./frontend-lib/shell/terminal-cursor.js"
import { findSshPrivateKey } from "./frontend-lib/usecases/path-helpers.js"
import type { HostError } from "./host-errors.js"
import { writeToTerminal } from "./menu-shared.js"
import { type ProjectItem, projectItemFromApiDetails } from "./project-item.js"
import { attachTerminalSession } from "./terminal-session-client.js"

export type OpenResolvedProjectSshDeps = {
  readonly createSession: (
    projectId: string
  ) => Effect.Effect<
    {
      readonly project: Readonly<Record<string, string | number | boolean | null | undefined>>
      readonly session: ApiTerminalSession
    } | null,
    HostError,
    ControllerRuntime
  >
  readonly attach: (
    project: ProjectItem,
    session: ApiTerminalSession
  ) => Effect.Effect<void, HostError>
}

const missingTerminalSessionError = (item: ProjectItem): HostError => ({
  _tag: "TerminalSessionClientError",
  message: `Terminal session was not created for ${item.displayName}.`
})

export const openResolvedProjectSshEffect = (
  item: ProjectItem,
  deps: OpenResolvedProjectSshDeps
) =>
  Effect.gen(function*(_) {
    const prepared = yield* _(deps.createSession(item.projectDir))
    if (prepared === null) {
      return yield* _(Effect.fail(missingTerminalSessionError(item)))
    }

    yield* _(deps.attach(item, prepared.session))
  })

export type OpenHostProjectSshDeps<E, R> = {
  readonly writeHeader: (item: ProjectItem) => Effect.Effect<void>
  readonly runCommand: (item: ProjectItem) => Effect.Effect<void, E, R>
}

export type OpenResolvedProjectSshWithUpDeps<E, R> = {
  readonly openProjectSsh: (item: ProjectItem) => Effect.Effect<void, E, R>
  readonly upProject: (projectId: string) => Effect.Effect<ProjectItem | null, E, R>
}

type HostSshLaunchSpec = {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly label: string
}

const sshPortPattern = /(?:^|\s)-p\s+(\d+)(?:\s|$)/u

const resolveSshTarget = (sshCommand: string): string | null => {
  const tokens = sshCommand.trim().split(/\s+/u)
  const target = tokens.at(-1)?.trim() ?? ""
  return target.includes("@") ? target : null
}

const resolveSshHost = (sshCommand: string): string | null => {
  const target = resolveSshTarget(sshCommand)
  if (target === null) {
    return null
  }

  const atIndex = target.lastIndexOf("@")
  return atIndex === -1 ? null : target.slice(atIndex + 1)
}

const resolveSshPort = (sshCommand: string, fallback: number): number => {
  const match = sshPortPattern.exec(sshCommand)
  if (match === null) {
    return fallback
  }

  const parsed = Number.parseInt(match[1] ?? "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const resolveHostSshEndpoint = (
  item: ProjectItem
): {
  readonly host: string
  readonly port: number
} =>
  isRemoteDockerHost()
    ? {
      host: resolveSshHost(item.sshCommand) ?? "127.0.0.1",
      port: resolveSshPort(item.sshCommand, item.sshPort)
    }
    : {
      host: "127.0.0.1",
      port: item.sshPort
    }

const buildHostSshArgs = (
  item: ProjectItem,
  sshKeyPath: string | null,
  host: string,
  port: number
): ReadonlyArray<string> => [
  ...(sshKeyPath === null ? [] : ["-i", sshKeyPath]),
  "-tt",
  "-Y",
  "-o",
  "LogLevel=ERROR",
  "-o",
  "StrictHostKeyChecking=no",
  "-o",
  "UserKnownHostsFile=/dev/null",
  "-p",
  String(port),
  `${item.sshUser}@${host}`
]

const renderHostSshCommand = (spec: HostSshLaunchSpec): string => [spec.command, ...spec.args].join(" ")

const resolveHostSshLaunchSpec = (
  item: ProjectItem
): Effect.Effect<HostSshLaunchSpec, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const sshKeyPath = yield* _(findSshPrivateKey(fs, path, process.cwd()))
    const endpoint = resolveHostSshEndpoint(item)
    const args = buildHostSshArgs(item, sshKeyPath, endpoint.host, endpoint.port)
    const spec = {
      command: "ssh",
      args,
      label: ""
    }

    return {
      ...spec,
      label: renderHostSshCommand(spec)
    }
  })

const writeProjectSshHeader = (item: ProjectItem): Effect.Effect<void> =>
  Effect.sync(() => {
    writeToTerminal(`\n[docker-git] SSH terminal: ${item.displayName}\n`)
    writeToTerminal(`[docker-git] ${item.sshCommand}\n\n`)
  })

const runProjectSshCommand = (
  launch: HostSshLaunchSpec,
  attempt = 0
): Effect.Effect<void, CommandFailedError | PlatformError, ControllerRuntime> =>
  withPreservedTerminalState(
    runCommandWithExitCodes(
      {
        cwd: process.cwd(),
        command: launch.command,
        args: launch.args
      },
      [0, 130],
      (exitCode) => new CommandFailedError({ command: launch.label, exitCode })
    )
  ).pipe(
    Effect.catchTag("CommandFailedError", (error) =>
      error.exitCode === 255 && attempt < 5
        ? Effect.sleep(Duration.seconds(1)).pipe(
          Effect.zipRight(runProjectSshCommand(launch, attempt + 1))
        )
        : Effect.fail(error))
  )

export const openHostProjectSshEffect = <E, R>(
  item: ProjectItem,
  deps: OpenHostProjectSshDeps<E, R>
) =>
  Effect.gen(function*(_) {
    yield* _(deps.writeHeader(item))
    yield* _(deps.runCommand(item))
  })

export const openResolvedProjectSshWithUpEffect = <E, R>(
  item: ProjectItem,
  deps: OpenResolvedProjectSshWithUpDeps<E, R>
) =>
  Effect.gen(function*(_) {
    const refreshedItem = yield* _(deps.upProject(item.projectDir))
    yield* _(deps.openProjectSsh(refreshedItem ?? item))
  })

const upProjectItem = (projectId: string) =>
  upProject(projectId).pipe(
    Effect.map((project) => (project === null ? null : projectItemFromApiDetails(project)))
  )

export const openResolvedProjectSsh = (item: ProjectItem) =>
  Effect.gen(function*(_) {
    const launch = yield* _(resolveHostSshLaunchSpec(item))
    const renderableItem = {
      ...item,
      sshCommand: launch.label
    }

    yield* _(
      openHostProjectSshEffect(renderableItem, {
        writeHeader: writeProjectSshHeader,
        runCommand: () => runProjectSshCommand(launch)
      })
    )
  })

export const openResolvedProjectSshWithUp = (item: ProjectItem) =>
  openResolvedProjectSshWithUpEffect<HostError, ControllerRuntime | FileSystem.FileSystem | Path.Path>(item, {
    openProjectSsh: openResolvedProjectSsh,
    upProject: upProjectItem
  })

export const openResolvedProjectSshViaController = (item: ProjectItem) =>
  openResolvedProjectSshEffect(item, {
    createSession: (projectId) => createProjectTerminalSession(projectId),
    attach: (project, session) =>
      attachTerminalSession({
        header: `SSH terminal: ${project.displayName}`,
        session,
        websocketPath: `/projects/${encodeURIComponent(project.projectDir)}/terminal-sessions/${
          encodeURIComponent(session.id)
        }/ws`
      })
  })

export const openResolvedProjectSshViaControllerWithUp = (item: ProjectItem) =>
  openResolvedProjectSshWithUpEffect<HostError, ControllerRuntime>(item, {
    openProjectSsh: openResolvedProjectSshViaController,
    upProject: upProjectItem
  })
