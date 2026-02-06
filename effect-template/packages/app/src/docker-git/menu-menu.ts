import { parseMenuSelection } from "@effect-template/lib/core/domain"
import { isRepoUrlInput } from "@effect-template/lib/usecases/menu-helpers"
import { Either } from "effect"

import { handleMenuActionSelection, type MenuSelectionContext } from "./menu-actions.js"
import { startCreateView } from "./menu-create.js"
import { menuItems } from "./menu-types.js"

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
    startCreateView(context.setView, context.setMessage, trimmed)
    return true
  }
  const selection = parseMenuSelection(input)
  if (Either.isRight(selection)) {
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
