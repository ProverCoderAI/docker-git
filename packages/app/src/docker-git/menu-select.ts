import { Match } from "effect"

import {
  runAuthSelection,
  runConnectSelection,
  runDeleteSelection,
  runDownSelection,
  runInfoSelection,
  type SelectContext
} from "./menu-select-actions.js"
import { isConnectMcpToggleInput } from "./menu-select-connect.js"
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
  if (input.trim().length > 0) {
    context.setMessage("Use arrows + Enter to select a project, Esc to cancel.")
  }
}

const handleConnectOptionToggle = (
  input: string,
  view: Extract<ViewState, { readonly _tag: "SelectProject" }>,
  context: Pick<SelectContext, "setView" | "setMessage">
): boolean => {
  if (view.purpose !== "Connect" || !isConnectMcpToggleInput(input)) {
    return false
  }
  const nextValue = !view.connectEnableMcpPlaywright
  context.setView({ ...view, connectEnableMcpPlaywright: nextValue, confirmDelete: false })
  context.setMessage(
    nextValue
      ? "Playwright MCP will be enabled before SSH (press Enter to connect)."
      : "Playwright MCP toggle is OFF (press Enter to connect without changes)."
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
