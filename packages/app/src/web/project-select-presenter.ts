import { Match } from "effect"

import type { SelectProjectRuntime } from "./project-select-types.js"

export type SelectPurpose = "Connect" | "Down" | "Info" | "Delete" | "Auth"

export type SelectListProject = {
  readonly displayName: string
  readonly repoRef: string
  readonly projectDir: string
  readonly clonedOnHostname?: string | undefined
}

export type SelectDetailProject = SelectListProject & {
  readonly repoUrl: string
  readonly containerName: string
  readonly serviceName: string
  readonly sshCommand: string
  readonly targetDir: string
  readonly authorizedKeysPath: string
  readonly authorizedKeysExists: boolean
  readonly envGlobalPath: string
  readonly envProjectPath: string
  readonly codexAuthPath: string
  readonly codexHome: string
}

export type SelectDetailsModel = {
  readonly title: string
  readonly lines: ReadonlyArray<string>
}

type SelectDetailsContext = {
  readonly authSuffix: string
  readonly common: ReadonlyArray<string>
  readonly connectEnableMcpPlaywright: boolean
  readonly item: SelectDetailProject
  readonly refLabel: string
  readonly runtime: SelectProjectRuntime
}

const formatRepoRef = (repoRef: string): string => {
  const trimmed = repoRef.trim()
  const prPrefix = "refs/pull/"
  if (trimmed.startsWith(prPrefix)) {
    const rest = trimmed.slice(prPrefix.length)
    const number = rest.split("/")[0] ?? rest
    return `PR#${number}`
  }
  return trimmed.length > 0 ? trimmed : "main"
}

export const stoppedRuntime = (): SelectProjectRuntime => ({
  running: false,
  sshSessions: 0,
  startedAtIso: null,
  startedAtEpochMs: null
})

const pad2 = (value: number): string => value.toString().padStart(2, "0")

const formatUtcTimestamp = (epochMs: number, withSeconds: boolean): string => {
  const date = new Date(epochMs)
  const seconds = withSeconds ? `:${pad2(date.getUTCSeconds())}` : ""
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${
    pad2(
      date.getUTCHours()
    )
  }:${pad2(date.getUTCMinutes())}${seconds} UTC`
}

const renderStartedAtCompact = (runtime: SelectProjectRuntime): string =>
  runtime.startedAtEpochMs === null ? "-" : formatUtcTimestamp(runtime.startedAtEpochMs, false)

const renderStartedAtDetailed = (runtime: SelectProjectRuntime): string =>
  runtime.startedAtEpochMs === null ? "not available" : formatUtcTimestamp(runtime.startedAtEpochMs, true)

const renderRuntimeLabel = (runtime: SelectProjectRuntime): string =>
  `${runtime.running ? "running" : "stopped"}, ssh=${runtime.sshSessions}, started=${
    renderStartedAtCompact(
      runtime
    )
  }`

export const selectTitle = (purpose: SelectPurpose): string =>
  Match.value(purpose).pipe(
    Match.when("Connect", () => "docker-git / Select project"),
    Match.when("Auth", () => "docker-git / Project auth"),
    Match.when("Down", () => "docker-git / Stop container"),
    Match.when("Info", () => "docker-git / Show connection info"),
    Match.when("Delete", () => "docker-git / Delete project"),
    Match.exhaustive
  )

export const selectHint = (
  purpose: SelectPurpose,
  _connectEnableMcpPlaywright: boolean
): string =>
  Match.value(purpose).pipe(
    Match.when("Connect", () => "Enter = start if needed + SSH, Esc = back"),
    Match.when("Auth", () => "Enter = open project auth menu, Esc = back"),
    Match.when("Down", () => "Enter = stop container, Esc = back"),
    Match.when("Info", () => "Use arrows to browse details, Enter = set active, Esc = back"),
    Match.when("Delete", () => "Enter = ask/confirm delete, Esc = cancel"),
    Match.exhaustive
  )

export const buildSelectLabels = (
  items: ReadonlyArray<SelectListProject>,
  selected: number,
  purpose: SelectPurpose,
  runtimeByProject: Readonly<Record<string, SelectProjectRuntime>>
): ReadonlyArray<string> =>
  items.map((item, index) => {
    const prefix = index === selected ? ">" : " "
    const refLabel = formatRepoRef(item.repoRef)
    const hostLabel = item.clonedOnHostname === undefined ? "" : ` @${item.clonedOnHostname}`
    const runtime = runtimeByProject[item.projectDir] ?? stoppedRuntime()
    const runtimeSuffix = purpose === "Down" || purpose === "Delete"
      ? ` [${renderRuntimeLabel(runtime)}]`
      : ` [started=${renderStartedAtCompact(runtime)}]`
    return `${prefix} ${index + 1}. ${item.displayName} (${refLabel})${hostLabel}${runtimeSuffix}`
  })

export type SelectListWindow = {
  readonly start: number
  readonly end: number
}

export const buildSelectListWindow = (
  total: number,
  selected: number,
  maxVisible: number
): SelectListWindow => {
  if (total <= 0) {
    return { start: 0, end: 0 }
  }
  const visible = Math.max(1, maxVisible)
  if (total <= visible) {
    return { start: 0, end: total }
  }
  const boundedSelected = Math.min(Math.max(selected, 0), total - 1)
  const half = Math.floor(visible / 2)
  const maxStart = total - visible
  const start = Math.min(Math.max(boundedSelected - half, 0), maxStart)
  return { start, end: start + visible }
}

const buildSshSessionsLabel = (runtime: SelectProjectRuntime): string =>
  runtime.sshSessions === 1
    ? "1 active SSH session"
    : `${runtime.sshSessions} active SSH sessions`

const commonLines = (
  item: SelectDetailProject,
  runtime: SelectProjectRuntime
): ReadonlyArray<string> => [
  `Project directory: ${item.projectDir}`,
  `Container: ${item.containerName}`,
  `State: ${runtime.running ? "running" : "stopped"}`,
  `Started at: ${renderStartedAtDetailed(runtime)}`,
  `SSH sessions now: ${buildSshSessionsLabel(runtime)}`
]

const connectDetails = (context: SelectDetailsContext): SelectDetailsModel => ({
  title: "Connect + SSH",
  lines: [
    ...context.common,
    "If the container is stopped, docker-git starts it before SSH.",
    context.connectEnableMcpPlaywright
      ? "Playwright MCP: will be enabled before SSH (P to disable)."
      : "Playwright MCP: keep current project setting (P to enable before SSH).",
    `Repo: ${context.item.repoUrl} (${context.refLabel})`,
    `SSH command: ${context.item.sshCommand}`
  ]
})

const authDetails = (context: SelectDetailsContext): SelectDetailsModel => ({
  title: "Project auth",
  lines: [
    ...context.common,
    `Repo: ${context.item.repoUrl} (${context.refLabel})`,
    `Env global: ${context.item.envGlobalPath}`,
    `Env project: ${context.item.envProjectPath}`,
    "Press Enter to manage labels for this project."
  ]
})

const infoDetails = (context: SelectDetailsContext): SelectDetailsModel => ({
  title: "Connection info",
  lines: [
    ...context.common,
    `Service: ${context.item.serviceName}`,
    `SSH command: ${context.item.sshCommand}`,
    `Repo: ${context.item.repoUrl} (${context.refLabel})`,
    `Workspace: ${context.item.targetDir}`,
    `Authorized keys: ${context.item.authorizedKeysPath}${context.authSuffix}`,
    `Env global: ${context.item.envGlobalPath}`,
    `Env project: ${context.item.envProjectPath}`,
    `Codex auth: ${context.item.codexAuthPath} -> ${context.item.codexHome}`
  ]
})

const downDetails = (context: SelectDetailsContext): SelectDetailsModel => ({
  title: "Stop container",
  lines: [...context.common, `Repo: ${context.item.repoUrl} (${context.refLabel})`]
})

const deleteDetails = (context: SelectDetailsContext): SelectDetailsModel => ({
  title: "Delete project",
  lines: [
    ...context.common,
    context.runtime.sshSessions > 0
      ? "Warning: project has active SSH sessions."
      : "No active SSH sessions detected.",
    `Repo: ${context.item.repoUrl} (${context.refLabel})`,
    "Removes project folder and runs docker compose down -v."
  ]
})

export const buildSelectDetailsModel = (
  purpose: SelectPurpose,
  item: SelectDetailProject | undefined,
  runtime: SelectProjectRuntime,
  connectEnableMcpPlaywright: boolean
): SelectDetailsModel => {
  if (item === undefined) {
    return { title: "No project selected", lines: ["No project selected."] }
  }

  const context: SelectDetailsContext = {
    authSuffix: item.authorizedKeysExists ? "" : " (missing)",
    common: commonLines(item, runtime),
    connectEnableMcpPlaywright,
    item,
    refLabel: formatRepoRef(item.repoRef),
    runtime
  }

  return Match.value(purpose).pipe(
    Match.when("Connect", () => connectDetails(context)),
    Match.when("Auth", () => authDetails(context)),
    Match.when("Info", () => infoDetails(context)),
    Match.when("Down", () => downDetails(context)),
    Match.when("Delete", () => deleteDetails(context)),
    Match.exhaustive
  )
}
