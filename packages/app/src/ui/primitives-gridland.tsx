import React, { type JSX } from "react"

import type { GridlandInputProps, GridlandModule } from "@gridland/bun"

import type { UiBoxProps, UiButtonProps, UiTextInputProps, UiTextProps } from "./primitives.js"

const renderInputValue = (props: UiTextInputProps): string => {
  if (props.value.length === 0) {
    return props.placeholder ?? ""
  }
  return props.secret ? "*".repeat(props.value.length) : props.value
}

const inputProps = (props: UiTextInputProps): GridlandInputProps => ({
  placeholder: props.placeholder,
  value: renderInputValue(props)
})

// CHANGE: render Gridland primitives through host component tags instead of helper functions
// WHY: @gridland/bun helper functions return Gridland vnode objects, not React elements; using them as JSX
//      children causes React reconciliation to reject the returned object tree in the TTY menu runtime
// QUOTE(ТЗ): "ЧТо бы я мог меню открыть"
// REF: user-request-2026-04-13-gridland-menu-fix
// SOURCE: n/a
// FORMAT THEOREM: ∀p: hostTag(p) → reactElement(p) ∧ renderable(p)
// PURITY: SHELL
// EFFECT: n/a
// INVARIANT: Gridland TUI primitives always return React elements with supported host tags
// COMPLEXITY: O(1)
export const createGridlandPrimitives = (_gridland: GridlandModule) => ({
  Box: ({ children, ...props }: UiBoxProps): JSX.Element =>
    React.createElement("box", {
      ...props,
      children
    }),
  Button: ({ label, onPress }: UiButtonProps): JSX.Element =>
    React.createElement("text", {
      children: `[${label}]`,
      fg: "cyan",
      onClick: onPress
    }),
  Text: ({ children, ...props }: UiTextProps): JSX.Element =>
    React.createElement("text", {
      ...props,
      children
    }),
  TextInput: (props: UiTextInputProps): JSX.Element =>
    React.createElement("input", {
      ...inputProps(props),
      focused: props.autoFocus,
      onChange: props.onChange,
      onSubmit: () => {
        props.onEnter?.(false)
      }
    })
}) as const
