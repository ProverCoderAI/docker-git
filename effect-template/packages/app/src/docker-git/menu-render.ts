import { Match } from "effect"
import { Box, Text } from "ink"
import React from "react"

import type { ProjectItem } from "@effect-template/lib/usecases/projects"
import type { CreateInputs, CreateStep } from "./menu-types.js"
import { createSteps, menuItems } from "./menu-types.js"

// CHANGE: render menu views with Ink without JSX
// WHY: keep UI logic separate from input/state reducers
// QUOTE(ТЗ): "TUI? Красивый, удобный"
// REF: user-request-2026-02-01-tui
// SOURCE: n/a
// FORMAT THEOREM: forall v: view(v) -> render(v)
// PURITY: SHELL
// EFFECT: n/a
// INVARIANT: menu renders all items once
// COMPLEXITY: O(n)

export const renderStepLabel = (step: CreateStep, defaults: CreateInputs): string =>
  Match.value(step).pipe(
    Match.when("repoUrl", () => "Repo URL"),
    Match.when("repoRef", () => `Repo ref [${defaults.repoRef}]`),
    Match.when("outDir", () => `Output dir [${defaults.outDir}]`),
    Match.when("runUp", () => `Run docker compose up now? [${defaults.runUp ? "Y" : "n"}]`),
    Match.when("force", () => `Overwrite existing files? [${defaults.force ? "y" : "N"}]`),
    Match.exhaustive
  )

const renderMessage = (message: string | null): React.ReactElement | null => {
  if (!message) {
    return null
  }
  return React.createElement(
    Box,
    { marginTop: 1 },
    React.createElement(Text, { color: "magenta" }, message)
  )
}

const renderLayout = (
  title: string,
  body: ReadonlyArray<React.ReactElement>,
  message: string | null
): React.ReactElement => {
  const el = React.createElement
  const messageView = renderMessage(message)
  const tail = messageView ? [messageView] : []
  return el(
    Box,
    { flexDirection: "column", padding: 1, borderStyle: "round" },
    el(Text, { color: "cyan", bold: true }, title),
    ...body,
    ...tail
  )
}

const compactElements = (
  items: ReadonlyArray<React.ReactElement | null>
): ReadonlyArray<React.ReactElement> => items.filter((item): item is React.ReactElement => item !== null)

const renderMenuHints = (el: typeof React.createElement): React.ReactElement =>
  el(
    Box,
    { marginTop: 1, flexDirection: "column" },
    el(Text, { color: "gray" }, "Hints:"),
    el(Text, { color: "gray" }, "  - Paste repo URL to create directly."),
    el(
      Text,
      { color: "gray" },
      "  - Aliases: create/c, select/s, info/i, up/u, status/ps, logs/l, down/d, down-all/da, quit/q"
    ),
    el(Text, { color: "gray" }, "  - Use arrows and Enter to run.")
  )

const renderMenuMessage = (
  el: typeof React.createElement,
  message: string | null
): React.ReactElement | null => {
  if (!message || message.length === 0) {
    return null
  }
  return el(
    Box,
    { marginTop: 1, flexDirection: "column" },
    ...message
      .split("\n")
      .map((line, index) => el(Text, { key: `${index}-${line}`, color: "magenta" }, line))
  )
}

export const renderMenu = (
  cwd: string,
  activeDir: string | null,
  selected: number,
  busy: boolean,
  message: string | null
): React.ReactElement => {
  const el = React.createElement
  const activeLabel = `Active: ${activeDir ?? "(none)"}`
  const cwdLabel = `CWD: ${cwd}`
  const items = menuItems.map((item, index) => {
    const indexLabel = `${index + 1})`
    const prefix = index === selected ? ">" : " "
    return el(
      Text,
      { key: item.label, color: index === selected ? "green" : "white" },
      `${prefix} ${indexLabel} ${item.label}`
    )
  })

  const busyView = busy
    ? el(Box, { marginTop: 1 }, el(Text, { color: "yellow" }, "Running..."))
    : null

  const messageView = renderMenuMessage(el, message)
  const hints = renderMenuHints(el)

  return renderLayout(
    "docker-git",
    compactElements([
      el(Text, null, activeLabel),
      el(Text, null, cwdLabel),
      el(Box, { flexDirection: "column", marginTop: 1 }, ...items),
      hints,
      busyView,
      messageView
    ]),
    null
  )
}

export const renderCreate = (
  label: string,
  buffer: string,
  message: string | null,
  stepIndex: number,
  defaults: CreateInputs
): React.ReactElement => {
  const el = React.createElement
  const steps = createSteps.map((step, index) =>
    el(
      Text,
      { key: step, color: index === stepIndex ? "green" : "gray" },
      `${index === stepIndex ? ">" : " "} ${renderStepLabel(step, defaults)}`
    )
  )
  return renderLayout(
    "docker-git / Create",
    [
      el(Box, { flexDirection: "column", marginTop: 1 }, ...steps),
      el(
        Box,
        { marginTop: 1 },
        el(Text, null, `${label}: `),
        el(Text, { color: "green" }, buffer)
      ),
      el(Box, { marginTop: 1 }, el(Text, { color: "gray" }, "Enter = next, Esc = cancel."))
    ],
    message
  )
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

const renderSelectDetails = (
  el: typeof React.createElement,
  item: ProjectItem | undefined
): ReadonlyArray<React.ReactElement> => {
  if (!item) {
    return [el(Text, { color: "gray", wrap: "truncate" }, "No project selected.")]
  }

  return [
    el(Text, { color: "cyan", bold: true, wrap: "truncate" }, "Details"),
    el(Text, { wrap: "truncate" }, `Repo: ${item.repoUrl}`),
    el(Text, { wrap: "truncate" }, `Ref: ${item.repoRef}`),
    el(Text, { wrap: "truncate" }, `Project dir: ${item.projectDir}`),
    el(Text, { wrap: "truncate" }, `Workspace: ${item.targetDir}`),
    el(Text, { wrap: "truncate" }, `SSH: ${item.sshCommand}`)
  ]
}

type SelectPurpose = "Connect" | "Down"

const selectTitle = (purpose: SelectPurpose): string =>
  Match.value(purpose).pipe(
    Match.when("Connect", () => "docker-git / Select project"),
    Match.when("Down", () => "docker-git / Stop container"),
    Match.exhaustive
  )

const selectHint = (purpose: SelectPurpose): string =>
  Match.value(purpose).pipe(
    Match.when("Connect", () => "Enter = select + SSH, Esc = back"),
    Match.when("Down", () => "Enter = stop container, Esc = back"),
    Match.exhaustive
  )

const buildSelectLabels = (
  items: ReadonlyArray<ProjectItem>,
  selected: number
): ReadonlyArray<string> =>
  items.map((item, index) => {
    const prefix = index === selected ? ">" : " "
    const refLabel = formatRepoRef(item.repoRef)
    return `${prefix} ${index + 1}. ${item.displayName} (${refLabel})`
  })

const computeListWidth = (labels: ReadonlyArray<string>): number => {
  const maxLabelWidth = labels.length > 0 ? Math.max(...labels.map((label) => label.length)) : 24
  return Math.min(Math.max(maxLabelWidth + 2, 28), 54)
}

const renderSelectListBox = (
  el: typeof React.createElement,
  items: ReadonlyArray<ProjectItem>,
  selected: number,
  labels: ReadonlyArray<string>,
  width: number
): React.ReactElement => {
  const list = labels.map((label, index) =>
    el(
      Text,
      {
        key: items[index]?.projectDir ?? String(index),
        color: index === selected ? "green" : "white",
        wrap: "truncate"
      },
      label
    )
  )

  return el(
    Box,
    { flexDirection: "column", width },
    ...(list.length > 0 ? list : [el(Text, { color: "gray" }, "No projects found.")])
  )
}

const renderSelectDetailsBox = (
  el: typeof React.createElement,
  items: ReadonlyArray<ProjectItem>,
  selected: number
): React.ReactElement => {
  const details = renderSelectDetails(el, items[selected])
  return el(
    Box,
    { flexDirection: "column", marginLeft: 2, flexGrow: 1 },
    ...details
  )
}

export const renderSelect = (
  purpose: SelectPurpose,
  items: ReadonlyArray<ProjectItem>,
  selected: number,
  message: string | null
): React.ReactElement => {
  const el = React.createElement
  const listLabels = buildSelectLabels(items, selected)
  const listWidth = computeListWidth(listLabels)
  const listBox = renderSelectListBox(el, items, selected, listLabels, listWidth)
  const detailsBox = renderSelectDetailsBox(el, items, selected)
  const hints = el(Box, { marginTop: 1 }, el(Text, { color: "gray" }, selectHint(purpose)))

  return renderLayout(
    selectTitle(purpose),
    [
      el(Box, { flexDirection: "row", marginTop: 1 }, listBox, detailsBox),
      hints
    ],
    message
  )
}
