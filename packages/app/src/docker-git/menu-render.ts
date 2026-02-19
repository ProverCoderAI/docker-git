import { Match } from "effect"
import { Box, Text } from "ink"
import React from "react"

import type { ProjectItem } from "@effect-template/lib/usecases/projects"
import { renderLayout } from "./menu-render-layout.js"
import {
  buildSelectLabels,
  buildSelectListWindow,
  renderSelectDetails,
  selectHint,
  type SelectPurpose,
  selectTitle
} from "./menu-render-select.js"
import type { CreateInputs, CreateStep, SelectProjectRuntime } from "./menu-types.js"
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
    Match.when(
      "mcpPlaywright",
      () => `Enable Playwright MCP (Chromium sidecar)? [${defaults.enableMcpPlaywright ? "y" : "N"}]`
    ),
    Match.when(
      "force",
      () => `Force recreate (overwrite files + wipe volumes)? [${defaults.force ? "y" : "N"}]`
    ),
    Match.exhaustive
  )

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
      "  - Aliases: create/c, select/s, auth/a, project-auth/pa, info/i, status/ps, logs/l, down/d, down-all/da, delete/del, quit/q"
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

type MenuRenderInput = {
  readonly cwd: string
  readonly activeDir: string | null
  readonly runningDockerGitContainers: number
  readonly selected: number
  readonly busy: boolean
  readonly message: string | null
}

export const renderMenu = (input: MenuRenderInput): React.ReactElement => {
  const { activeDir, busy, cwd, message, runningDockerGitContainers, selected } = input
  const el = React.createElement
  const activeLabel = `Active: ${activeDir ?? "(none)"}`
  const runningLabel = `Running docker-git containers: ${runningDockerGitContainers}`
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
      el(Text, null, runningLabel),
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

export { renderAuthMenu, renderAuthPrompt } from "./menu-render-auth.js"
export { renderProjectAuthMenu, renderProjectAuthPrompt } from "./menu-render-project-auth.js"

const computeListWidth = (labels: ReadonlyArray<string>): number => {
  const maxLabelWidth = labels.length > 0 ? Math.max(...labels.map((label) => label.length)) : 24
  return Math.min(Math.max(maxLabelWidth + 2, 28), 54)
}

const readStdoutRows = (): number | null => {
  const rows = process.stdout.rows
  if (typeof rows !== "number" || !Number.isFinite(rows) || rows <= 0) {
    return null
  }
  return rows
}

const computeSelectListMaxRows = (): number => {
  const rows = readStdoutRows()
  if (rows === null) {
    return 12
  }
  return Math.max(6, rows - 14)
}

const renderSelectListBox = (
  el: typeof React.createElement,
  items: ReadonlyArray<ProjectItem>,
  selected: number,
  labels: ReadonlyArray<string>,
  width: number
): React.ReactElement => {
  const window = buildSelectListWindow(labels.length, selected, computeSelectListMaxRows())
  const hiddenAbove = window.start
  const hiddenBelow = labels.length - window.end
  const visibleLabels = labels.slice(window.start, window.end)
  const list = visibleLabels.map((label, offset) => {
    const index = window.start + offset
    return el(
      Text,
      {
        key: items[index]?.projectDir ?? String(index),
        color: index === selected ? "green" : "white",
        wrap: "truncate"
      },
      label
    )
  })

  const before = hiddenAbove > 0
    ? [el(Text, { color: "gray", wrap: "truncate" }, `[scroll] ${hiddenAbove} more above`)]
    : []
  const after = hiddenBelow > 0
    ? [el(Text, { color: "gray", wrap: "truncate" }, `[scroll] ${hiddenBelow} more below`)]
    : []
  const listBody = list.length > 0 ? list : [el(Text, { color: "gray" }, "No projects found.")]

  return el(
    Box,
    { flexDirection: "column", width },
    ...before,
    ...listBody,
    ...after
  )
}

type SelectDetailsBoxInput = {
  readonly purpose: SelectPurpose
  readonly items: ReadonlyArray<ProjectItem>
  readonly selected: number
  readonly runtimeByProject: Readonly<Record<string, SelectProjectRuntime>>
  readonly connectEnableMcpPlaywright: boolean
}

const renderSelectDetailsBox = (
  el: typeof React.createElement,
  input: SelectDetailsBoxInput
): React.ReactElement => {
  const details = renderSelectDetails(
    el,
    input.purpose,
    input.items[input.selected],
    input.runtimeByProject,
    input.connectEnableMcpPlaywright
  )
  return el(
    Box,
    { flexDirection: "column", marginLeft: 2, flexGrow: 1 },
    ...details
  )
}

export const renderSelect = (
  input: {
    readonly purpose: SelectPurpose
    readonly items: ReadonlyArray<ProjectItem>
    readonly selected: number
    readonly runtimeByProject: Readonly<Record<string, SelectProjectRuntime>>
    readonly confirmDelete: boolean
    readonly connectEnableMcpPlaywright: boolean
    readonly message: string | null
  }
): React.ReactElement => {
  const { confirmDelete, connectEnableMcpPlaywright, items, message, purpose, runtimeByProject, selected } = input
  const el = React.createElement
  const listLabels = buildSelectLabels(items, selected, purpose, runtimeByProject)
  const listWidth = computeListWidth(listLabels)
  const listBox = renderSelectListBox(el, items, selected, listLabels, listWidth)
  const detailsBox = renderSelectDetailsBox(el, {
    purpose,
    items,
    selected,
    runtimeByProject,
    connectEnableMcpPlaywright
  })
  const baseHint = selectHint(purpose, connectEnableMcpPlaywright)
  const confirmHint = (() => {
    if (purpose === "Delete" && confirmDelete) {
      return "Confirm mode: Enter = delete now, Esc = cancel"
    }
    if (purpose === "Down" && confirmDelete) {
      return "Confirm mode: Enter = stop now, Esc = cancel"
    }
    return baseHint
  })()
  const hints = el(Box, { marginTop: 1 }, el(Text, { color: "gray" }, confirmHint))

  return renderLayout(
    selectTitle(purpose),
    [
      el(Box, { flexDirection: "row", marginTop: 1 }, listBox, detailsBox),
      hints
    ],
    message
  )
}
