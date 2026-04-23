import { Match } from "effect"

import { nextBufferValue } from "./menu-buffer-input.js"
import {
  runAuthSelection,
  runConnectSelection,
  runDeleteSelection,
  runDownSelection,
  runInfoSelection,
  type SelectContext
} from "./menu-select-actions.js"
import { isConnectMcpToggleInput } from "./menu-select-connect.js"
import { filterProjectItemsByQuery } from "./menu-select-filter.js"
import { runtimeForSelection } from "./menu-select-runtime.js"
import { resetToMenu } from "./menu-shared.js"
import type { MenuKeyInput, ViewState } from "./menu-types.js"

export { startSelectView } from "./menu-select-view.js"

const clampIndex = (value: number, size: number): number => {
  if (size <= 0) {
    return 0
  }
  if (value < 0) {
    return 0
  }
  if (value >= size) {
    return size - 1
  }
  return value
}

const updateSelectSearch = (
  view: Extract<ViewState, { readonly _tag: "SelectProject" }>,
  query: string
): Extract<ViewState, { readonly _tag: "SelectProject" }> => {
  const selectedProjectDir = view.items[view.selected]?.projectDir
  const items = filterProjectItemsByQuery(view.allItems, query)
  const nextSelected = selectedProjectDir === undefined
    ? 0
    : items.findIndex((item) => item.projectDir === selectedProjectDir)
  return {
    ...view,
    confirmDelete: false,
    items,
    query,
    selected: clampIndex(nextSelected, items.length)
  }
}

const selectSearchMessage = (
  view: Extract<ViewState, { readonly _tag: "SelectProject" }>
): string | null =>
  view.query.length === 0
    ? null
    : `Search "${view.query}": ${view.items.length}/${view.allItems.length} project(s).`

const handleSelectSearchInput = (
  input: string,
  key: MenuKeyInput,
  view: Extract<ViewState, { readonly _tag: "SelectProject" }>,
  context: SelectContext
): boolean => {
  const nextQuery = nextBufferValue(input, key, view.query)
  if (nextQuery === null) {
    return false
  }
  const nextView = updateSelectSearch(view, nextQuery)
  context.setView(nextView)
  context.setMessage(selectSearchMessage(nextView))
  return true
}

export const handleSelectInput = (
  input: string,
  key: MenuKeyInput,
  view: Extract<ViewState, { readonly _tag: "SelectProject" }>,
  context: SelectContext
) => {
  if (key.escape) {
    resetToMenu(context)
    return
  }
  if (handleConnectOptionToggle(input, view, context)) {
    return
  }
  if (handleSelectNavigation(key, view, context)) {
    return
  }
  if (key.return) {
    handleSelectReturn(view, context)
    return
  }
  if (handleSelectSearchInput(input, key, view, context)) {
    return
  }
  if (input.trim().length > 0) {
    context.setMessage("Type to search by container/project name, arrows + Enter to select, Esc to cancel.")
  }
}

const handleConnectOptionToggle = (
  input: string,
  view: Extract<ViewState, { readonly _tag: "SelectProject" }>,
  context: Pick<SelectContext, "setView" | "setMessage">
): boolean => {
  if (view.purpose !== "Connect" || view.query.length > 0 || input !== "P" || !isConnectMcpToggleInput(input)) {
    return false
  }
  context.setMessage(
    "Playwright MCP pre-connect toggle is not routed through the controller yet."
  )
  return true
}

const handleSelectNavigation = (
  key: MenuKeyInput,
  view: Extract<ViewState, { readonly _tag: "SelectProject" }>,
  context: SelectContext
): boolean => {
  if (key.upArrow) {
    const next = clampIndex(view.selected - 1, view.items.length)
    context.setView({ ...view, selected: next, confirmDelete: false })
    return true
  }
  if (key.downArrow) {
    const next = clampIndex(view.selected + 1, view.items.length)
    context.setView({ ...view, selected: next, confirmDelete: false })
    return true
  }
  return false
}

const formatSshSessionsLabel = (sshSessions: number): string =>
  sshSessions === 1 ? "1 active SSH session" : `${sshSessions} active SSH sessions`

const handleSelectReturn = (
  view: Extract<ViewState, { readonly _tag: "SelectProject" }>,
  context: SelectContext
) => {
  const selected = view.items[view.selected]
  if (!selected) {
    context.setMessage("No project selected.")
    resetToMenu(context)
    return
  }
  const selectedRuntime = runtimeForSelection(view, selected)
  const sshSessionsLabel = formatSshSessionsLabel(selectedRuntime.sshSessions)

  Match.value(view.purpose).pipe(
    Match.when("Connect", () => {
      context.setActiveDir(selected.projectDir)
      runConnectSelection(selected, context, view.connectEnableMcpPlaywright)
    }),
    Match.when("Auth", () => {
      context.setActiveDir(selected.projectDir)
      runAuthSelection(selected, context)
    }),
    Match.when("Down", () => {
      if (selectedRuntime.sshSessions > 0 && !view.confirmDelete) {
        context.setMessage(
          `${selected.containerName} has ${sshSessionsLabel}. Press Enter again to stop, Esc to cancel.`
        )
        context.setView({ ...view, confirmDelete: true })
        return
      }
      context.setActiveDir(selected.projectDir)
      runDownSelection(selected, context)
    }),
    Match.when("Info", () => {
      context.setActiveDir(selected.projectDir)
      runInfoSelection(selected, context)
    }),
    Match.when("Delete", () => {
      if (!view.confirmDelete) {
        const activeSshWarning = selectedRuntime.sshSessions > 0 ? ` ${sshSessionsLabel}.` : ""
        context.setMessage(
          `Really delete ${selected.displayName}?${activeSshWarning} Press Enter again to confirm, Esc to cancel.`
        )
        context.setView({ ...view, confirmDelete: true })
        return
      }
      runDeleteSelection(selected, context)
    }),
    Match.exhaustive
  )
}
