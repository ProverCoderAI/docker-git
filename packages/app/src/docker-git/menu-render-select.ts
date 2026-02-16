import { Match } from "effect"
import { Text } from "ink"
import type React from "react"

import type { ProjectItem } from "@effect-template/lib/usecases/projects"
import type { SelectProjectRuntime } from "./menu-types.js"

export type SelectPurpose = "Connect" | "Down" | "Info" | "Delete"

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

const stoppedRuntime = (): SelectProjectRuntime => ({ running: false, sshSessions: 0 })

const runtimeForProject = (
  runtimeByProject: Readonly<Record<string, SelectProjectRuntime>>,
  item: ProjectItem
): SelectProjectRuntime => runtimeByProject[item.projectDir] ?? stoppedRuntime()

const renderRuntimeLabel = (runtime: SelectProjectRuntime): string =>
  `${runtime.running ? "running" : "stopped"}, ssh=${runtime.sshSessions}`

export const selectTitle = (purpose: SelectPurpose): string =>
  Match.value(purpose).pipe(
    Match.when("Connect", () => "docker-git / Select project"),
    Match.when("Down", () => "docker-git / Stop container"),
    Match.when("Info", () => "docker-git / Show connection info"),
    Match.when("Delete", () => "docker-git / Delete project"),
    Match.exhaustive
  )

export const selectHint = (purpose: SelectPurpose): string =>
  Match.value(purpose).pipe(
    Match.when("Connect", () => "Enter = select + SSH, Esc = back"),
    Match.when("Down", () => "Enter = stop container, Esc = back"),
    Match.when("Info", () => "Use arrows to browse details, Enter = set active, Esc = back"),
    Match.when("Delete", () => "Enter = ask/confirm delete, Esc = cancel"),
    Match.exhaustive
  )

export const buildSelectLabels = (
  items: ReadonlyArray<ProjectItem>,
  selected: number,
  purpose: SelectPurpose,
  runtimeByProject: Readonly<Record<string, SelectProjectRuntime>>
): ReadonlyArray<string> =>
  items.map((item, index) => {
    const prefix = index === selected ? ">" : " "
    const refLabel = formatRepoRef(item.repoRef)
    const runtimeSuffix = purpose === "Down" || purpose === "Delete"
      ? ` [${renderRuntimeLabel(runtimeForProject(runtimeByProject, item))}]`
      : ""
    return `${prefix} ${index + 1}. ${item.displayName} (${refLabel})${runtimeSuffix}`
  })

type SelectDetailsContext = {
  readonly item: ProjectItem
  readonly refLabel: string
  readonly authSuffix: string
  readonly runtime: SelectProjectRuntime
  readonly sshSessionsLabel: string
}

const buildDetailsContext = (
  item: ProjectItem,
  runtimeByProject: Readonly<Record<string, SelectProjectRuntime>>
): SelectDetailsContext => {
  const runtime = runtimeForProject(runtimeByProject, item)
  return {
    item,
    refLabel: formatRepoRef(item.repoRef),
    authSuffix: item.authorizedKeysExists ? "" : " (missing)",
    runtime,
    sshSessionsLabel: runtime.sshSessions === 1
      ? "1 active SSH session"
      : `${runtime.sshSessions} active SSH sessions`
  }
}

const titleRow = (el: typeof React.createElement, value: string): React.ReactElement =>
  el(Text, { color: "cyan", bold: true, wrap: "truncate" }, value)

const commonRows = (
  el: typeof React.createElement,
  context: SelectDetailsContext
): ReadonlyArray<React.ReactElement> => [
  el(Text, { wrap: "wrap" }, `Project directory: ${context.item.projectDir}`),
  el(Text, { wrap: "wrap" }, `Container: ${context.item.containerName}`),
  el(Text, { wrap: "wrap" }, `State: ${context.runtime.running ? "running" : "stopped"}`),
  el(Text, { wrap: "wrap" }, `SSH sessions now: ${context.sshSessionsLabel}`)
]

const renderInfoDetails = (
  el: typeof React.createElement,
  context: SelectDetailsContext,
  common: ReadonlyArray<React.ReactElement>
): ReadonlyArray<React.ReactElement> => [
  titleRow(el, "Connection info"),
  ...common,
  el(Text, { wrap: "wrap" }, `Service: ${context.item.serviceName}`),
  el(Text, { wrap: "wrap" }, `SSH command: ${context.item.sshCommand}`),
  el(Text, { wrap: "wrap" }, `Repo: ${context.item.repoUrl} (${context.refLabel})`),
  el(Text, { wrap: "wrap" }, `Workspace: ${context.item.targetDir}`),
  el(Text, { wrap: "wrap" }, `Authorized keys: ${context.item.authorizedKeysPath}${context.authSuffix}`),
  el(Text, { wrap: "wrap" }, `Env global: ${context.item.envGlobalPath}`),
  el(Text, { wrap: "wrap" }, `Env project: ${context.item.envProjectPath}`),
  el(Text, { wrap: "wrap" }, `Codex auth: ${context.item.codexAuthPath} -> ${context.item.codexHome}`)
]

const renderDefaultDetails = (
  el: typeof React.createElement,
  context: SelectDetailsContext
): ReadonlyArray<React.ReactElement> => [
  titleRow(el, "Details"),
  el(Text, { wrap: "truncate" }, `Repo: ${context.item.repoUrl}`),
  el(Text, { wrap: "truncate" }, `Ref: ${context.item.repoRef}`),
  el(Text, { wrap: "truncate" }, `Project dir: ${context.item.projectDir}`),
  el(Text, { wrap: "truncate" }, `Workspace: ${context.item.targetDir}`),
  el(Text, { wrap: "truncate" }, `SSH: ${context.item.sshCommand}`)
]

export const renderSelectDetails = (
  el: typeof React.createElement,
  purpose: SelectPurpose,
  item: ProjectItem | undefined,
  runtimeByProject: Readonly<Record<string, SelectProjectRuntime>>
): ReadonlyArray<React.ReactElement> => {
  if (!item) {
    return [el(Text, { color: "gray", wrap: "truncate" }, "No project selected.")]
  }
  const context = buildDetailsContext(item, runtimeByProject)
  const common = commonRows(el, context)

  return Match.value(purpose).pipe(
    Match.when("Info", () => renderInfoDetails(el, context, common)),
    Match.when("Down", () => [
      titleRow(el, "Stop container"),
      ...common,
      el(Text, { wrap: "wrap" }, `Repo: ${context.item.repoUrl} (${context.refLabel})`)
    ]),
    Match.when("Delete", () => [
      titleRow(el, "Delete project"),
      ...common,
      context.runtime.sshSessions > 0
        ? el(Text, { color: "yellow", wrap: "wrap" }, "Warning: project has active SSH sessions.")
        : el(Text, { color: "gray", wrap: "wrap" }, "No active SSH sessions detected."),
      el(Text, { wrap: "wrap" }, `Repo: ${context.item.repoUrl} (${context.refLabel})`),
      el(Text, { wrap: "wrap" }, "Removes the project folder (no git history rewrite).")
    ]),
    Match.orElse(() => renderDefaultDetails(el, context))
  )
}
