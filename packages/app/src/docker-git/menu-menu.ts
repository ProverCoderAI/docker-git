import { Either } from "effect"

import { handleMenuActionSelection, type MenuSelectionContext } from "./menu-actions.js"
import { startCreateView } from "./menu-create.js"
import { type MenuAction, menuItems } from "./menu-types.js"

const isRepoUrlInput = (input: string): boolean => {
  const trimmed = input.trim().toLowerCase()
  return trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("ssh://") ||
    trimmed.startsWith("git@")
}

const menuAliasMap = new Map<string, MenuAction>([
  ["1", { _tag: "Create" }],
  ["create", { _tag: "Create" }],
  ["c", { _tag: "Create" }],
  ["2", { _tag: "Select" }],
  ["select", { _tag: "Select" }],
  ["s", { _tag: "Select" }],
  ["3", { _tag: "Auth" }],
  ["auth", { _tag: "Auth" }],
  ["a", { _tag: "Auth" }],
  ["4", { _tag: "ProjectAuth" }],
  ["project-auth", { _tag: "ProjectAuth" }],
  ["projectauth", { _tag: "ProjectAuth" }],
  ["pa", { _tag: "ProjectAuth" }],
  ["5", { _tag: "Info" }],
  ["info", { _tag: "Info" }],
  ["i", { _tag: "Info" }],
  ["6", { _tag: "Up" }],
  ["up", { _tag: "Up" }],
  ["u", { _tag: "Up" }],
  ["start", { _tag: "Up" }],
  ["7", { _tag: "Status" }],
  ["status", { _tag: "Status" }],
  ["ps", { _tag: "Status" }],
  ["8", { _tag: "Logs" }],
  ["logs", { _tag: "Logs" }],
  ["log", { _tag: "Logs" }],
  ["l", { _tag: "Logs" }],
  ["9", { _tag: "Down" }],
  ["down", { _tag: "Down" }],
  ["stop", { _tag: "Down" }],
  ["d", { _tag: "Down" }],
  ["10", { _tag: "DownAll" }],
  ["down-all", { _tag: "DownAll" }],
  ["downall", { _tag: "DownAll" }],
  ["stop-all", { _tag: "DownAll" }],
  ["stopall", { _tag: "DownAll" }],
  ["kill-all", { _tag: "DownAll" }],
  ["killall", { _tag: "DownAll" }],
  ["da", { _tag: "DownAll" }],
  ["11", { _tag: "Delete" }],
  ["delete", { _tag: "Delete" }],
  ["del", { _tag: "Delete" }],
  ["remove", { _tag: "Delete" }],
  ["rm", { _tag: "Delete" }],
  ["0", { _tag: "Quit" }],
  ["12", { _tag: "Quit" }],
  ["quit", { _tag: "Quit" }],
  ["q", { _tag: "Quit" }],
  ["exit", { _tag: "Quit" }]
])

const parseMenuSelection = (
  input: string
): Either.Either<MenuAction, { readonly _tag: "InvalidOption"; readonly option: string; readonly reason: string }> => {
  const normalized = input.trim().toLowerCase()
  if (normalized.length === 0) {
    return Either.left({ _tag: "InvalidOption", option: "menu", reason: "empty selection" })
  }

  const action = menuAliasMap.get(normalized)
  return action === undefined
    ? Either.left({ _tag: "InvalidOption", option: "menu", reason: `unknown selection: ${input}` })
    : Either.right(action)
}

const handleMenuNavigation = (
  key: { readonly upArrow?: boolean; readonly downArrow?: boolean },
  setSelected: (update: (value: number) => number) => void
) => {
  if (key.upArrow) {
    setSelected((prev) => (prev === 0 ? menuItems.length - 1 : prev - 1))
    return
  }
  if (key.downArrow) {
    setSelected((prev) => (prev === menuItems.length - 1 ? 0 : prev + 1))
  }
}

const handleMenuEnter = (context: MenuSelectionContext) => {
  const action = menuItems[context.selected]?.id
  if (!action) {
    return
  }
  handleMenuActionSelection(action, context)
}

const handleMenuTextInput = (input: string, context: MenuSelectionContext): boolean => {
  const trimmed = input.trim()
  if (trimmed.length > 0 && isRepoUrlInput(trimmed)) {
    context.setSkipInputs(() => 1)
    startCreateView(context.setView, context.setMessage, trimmed)
    return true
  }
  const selection = parseMenuSelection(input)
  if (Either.isRight(selection)) {
    context.setSkipInputs(() => 1)
    handleMenuActionSelection(selection.right, context)
    return true
  }
  return false
}

export const handleMenuInput = (
  input: string,
  key: { readonly upArrow?: boolean; readonly downArrow?: boolean; readonly return?: boolean },
  context: MenuSelectionContext
) => {
  if (key.upArrow || key.downArrow) {
    handleMenuNavigation(key, context.setSelected)
    return
  }
  if (key.return) {
    handleMenuEnter(context)
    return
  }
  handleMenuTextInput(input, context)
}
