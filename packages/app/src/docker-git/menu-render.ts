import React from "react"

import { Box, Text } from "../ui/primitives.js"
import { renderCreateStepLabel, settingsHint } from "./menu-create-shared.js"
import { renderLayout } from "./menu-render-layout.js"
import {
  buildSelectLabels,
  buildSelectListWindow,
  computeSelectColumnWidths,
  computeSelectListMaxRows,
  renderSelectDetails,
  selectHint,
  type SelectPurpose,
  selectTitle
} from "./menu-render-select.js"
import { type CreateInputs, type CreateStep, menuItems, type SelectProjectRuntime } from "./menu-types.js"
import type { ProjectItem } from "./project-item.js"

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

const compactElements = (
  items: ReadonlyArray<React.ReactElement | null>
): ReadonlyArray<React.ReactElement> => items.filter((item): item is React.ReactElement => item !== null)

const renderMenuHints = (el: typeof React.createElement): React.ReactElement =>
  el(
    Box,
    { marginTop: 1, flexDirection: "column" },
    el(Text, { fg: "gray" }, "Hints:"),
    el(Text, { fg: "gray" }, "  - Paste repo URL or URL + flags to start create."),
    el(
      Text,
      { fg: "gray" },
      "  - Aliases: create/c, select/s, auth/a, project-auth/pa, info/i, status/ps, logs/l, down/d, down-all/da, delete/del, quit/q"
    ),
    el(Text, { fg: "gray" }, "  - Use arrows and Enter to run.")
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
      .map((line, index) => el(Text, { key: `${index}-${line}`, fg: "magenta" }, line))
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

type CreateRenderInput = {
  readonly buffer: string
  readonly defaults: CreateInputs
  readonly label: string
  readonly message: string | null
  readonly stepIndex: number
  readonly steps: ReadonlyArray<CreateStep>
}

export const renderMenu = (input: MenuRenderInput): React.ReactElement => {
  const { activeDir, busy: isBusy, cwd, message, runningDockerGitContainers, selected } = input
  const el = React.createElement
  const activeLabel = `Active: ${activeDir ?? "(none)"}`
  const runningLabel = `Running docker-git containers: ${runningDockerGitContainers}`
  const cwdLabel = `CWD: ${cwd}`
  const items = menuItems.map((item, index) => {
    const indexLabel = `${index + 1})`
    const prefix = index === selected ? ">" : " "
    return el(
      Text,
      { key: item.label, fg: index === selected ? "green" : "white" },
      `${prefix} ${indexLabel} ${item.label}`
    )
  })

  const busyView = isBusy
    ? el(Box, { marginTop: 1 }, el(Text, { fg: "yellow" }, "Running..."))
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

export const renderCreate = (input: CreateRenderInput): React.ReactElement => {
  const { buffer, defaults, label, message, stepIndex, steps } = input
  const el = React.createElement
  const hint = stepIndex > 0 ? settingsHint : null
  const stepViews = steps.map((step, index) =>
    el(
      Text,
      { key: step, fg: index === stepIndex ? "green" : "gray" },
      `${index === stepIndex ? ">" : " "} ${renderCreateStepLabel(step, defaults)}`
    )
  )
  const labelText = el(Text, null, `${label}: `)
  const bufferText = el(Text, { fg: "green" }, buffer)
  const hintText = hint === null ? null : el(Text, { fg: "gray" }, hint)
  return renderLayout(
    "docker-git / Create",
    compactElements([
      el(Box, { flexDirection: "column", marginTop: 1 }, ...stepViews),
      el(Box, { marginTop: 1 }, labelText, bufferText),
      hintText === null ? null : el(Box, { marginTop: 1 }, hintText)
    ]),
    message
  )
}

export { renderAuthMenu, renderAuthPrompt } from "./menu-render-auth.js"
export { renderProjectAuthMenu, renderProjectAuthPrompt } from "./menu-render-project-auth.js"

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
        fg: index === selected ? "green" : "white",
        width,
        wrap: "truncate"
      },
      label
    )
  })

  const before = hiddenAbove > 0
    ? [el(Text, { fg: "gray", width, wrap: "truncate" }, `[scroll] ${hiddenAbove} more above`)]
    : []
  const after = hiddenBelow > 0
    ? [el(Text, { fg: "gray", width, wrap: "truncate" }, `[scroll] ${hiddenBelow} more below`)]
    : []
  const listBody = list.length > 0 ? list : [el(Text, { fg: "gray", width, wrap: "truncate" }, "No projects found.")]

  return el(
    Box,
    { flexDirection: "column", width },
    ...before,
    ...listBody,
    ...after
  )
}

type SelectDetailsBoxInput = {
  readonly detailsWidth: number | null
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
    {
      connectEnableMcpPlaywright: input.connectEnableMcpPlaywright,
      detailsWidth: input.detailsWidth,
      item: input.items[input.selected],
      purpose: input.purpose,
      runtimeByProject: input.runtimeByProject
    }
  )
  return el(
    Box,
    {
      flexDirection: "column",
      marginLeft: 2,
      ...(input.detailsWidth === null ? { flexGrow: 1 } : { width: input.detailsWidth })
    },
    ...details
  )
}

type RenderSelectInput = {
  readonly purpose: SelectPurpose
  readonly items: ReadonlyArray<ProjectItem>
  readonly selected: number
  readonly query: string
  readonly runtimeByProject: Readonly<Record<string, SelectProjectRuntime>>
  readonly confirmDelete: boolean
  readonly connectEnableMcpPlaywright: boolean
  readonly message: string | null
}

const selectConfirmHint = (
  purpose: SelectPurpose,
  isConfirmDelete: boolean,
  shouldEnableMcpPlaywright: boolean
): string => {
  if (purpose === "Delete" && isConfirmDelete) {
    return "Confirm mode: Enter = delete now, Esc = cancel"
  }
  if (purpose === "Down" && isConfirmDelete) {
    return "Confirm mode: Enter = stop now, Esc = cancel"
  }
  return selectHint(purpose, shouldEnableMcpPlaywright)
}

const renderSelectSearch = (
  el: typeof React.createElement,
  query: string
): React.ReactElement =>
  el(
    Box,
    { marginTop: 1 },
    el(
      Text,
      { fg: "gray", wrap: "truncate" },
      `Search container/project: ${query.length === 0 ? "(type to filter)" : query}`
    )
  )

export const renderSelect = (input: RenderSelectInput): React.ReactElement => {
  const {
    confirmDelete: isConfirmDelete,
    connectEnableMcpPlaywright: isConnectEnableMcpPlaywright,
    items,
    message,
    purpose,
    query,
    runtimeByProject,
    selected
  } = input
  const el = React.createElement
  const listLabels = buildSelectLabels(items, selected, purpose, runtimeByProject)
  const { detailsWidth, listWidth } = computeSelectColumnWidths(listLabels)
  const listBox = renderSelectListBox(el, items, selected, listLabels, listWidth)
  const detailsBox = renderSelectDetailsBox(el, {
    detailsWidth,
    purpose,
    items,
    selected,
    runtimeByProject,
    connectEnableMcpPlaywright: isConnectEnableMcpPlaywright
  })
  const confirmHint = selectConfirmHint(purpose, isConfirmDelete, isConnectEnableMcpPlaywright)
  const hints = el(Box, { marginTop: 1 }, el(Text, { fg: "gray" }, confirmHint))
  const search = renderSelectSearch(el, query)

  return renderLayout(
    selectTitle(purpose),
    [
      search,
      el(Box, { flexDirection: "row", marginTop: 1 }, listBox, detailsBox),
      hints
    ],
    message
  )
}

export { renderCreateStepLabel as renderStepLabel } from "./menu-create-shared.js"
