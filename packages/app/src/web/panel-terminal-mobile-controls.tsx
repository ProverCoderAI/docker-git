import type { JSX } from "react"

import {
  mobileArrowRowStyle,
  mobileControlButtonStyle,
  mobileControlsCollapsedStyle,
  mobileControlsRowStyle,
  mobileControlsStyle
} from "./panel-terminal-styles.js"
import {
  isModifierOnlyTerminalKey,
  type MobileTerminalKey,
  mobileTerminalKeyInput,
  terminalControlCharacterForKey
} from "./terminal-mobile-controls.js"
import type { TerminalInputController } from "./terminal-panel-runtime.js"

type MobileTerminalControlsProps = {
  readonly collapsed: boolean
  readonly compactTypingMode: boolean
  readonly ctrlArmed: boolean
  readonly onKeyPress: (key: MobileTerminalKey) => void
  readonly onToggleCollapsed: () => void
  readonly onToggleCtrl: () => void
}

type MobileTerminalArrowKey = Extract<MobileTerminalKey, "down" | "left" | "right" | "up">

const mobileTerminalArrowKeys: ReadonlyArray<MobileTerminalArrowKey> = ["left", "up", "down", "right"]

const mobileTerminalArrowLabels: Readonly<Record<MobileTerminalArrowKey, string>> = {
  down: "↓",
  left: "←",
  right: "→",
  up: "↑"
}

export const retainTerminalFocus = (controller: TerminalInputController | null): void => {
  controller?.focus()
}

export const sendTerminalMobileInput = (
  controller: TerminalInputController | null,
  key: MobileTerminalKey
): void => {
  controller?.sendInput(mobileTerminalKeyInput(key))
  retainTerminalFocus(controller)
}

export const shouldKeepMobileCtrlArmed = (event: KeyboardEvent): boolean =>
  event.metaKey || event.altKey || event.ctrlKey || event.isComposing || isModifierOnlyTerminalKey(event.key)

export const sendMobileCtrlEventInput = (
  controller: TerminalInputController | null,
  event: KeyboardEvent
): void => {
  const controlCharacter = terminalControlCharacterForKey(event.key)
  if (controlCharacter === null) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  controller?.sendInput(controlCharacter)
  retainTerminalFocus(controller)
}

const MobileTerminalControlButton = (
  {
    active = false,
    label,
    onClick
  }: {
    readonly active?: boolean
    readonly label: string
    readonly onClick: () => void
  }
): JSX.Element => (
  <button
    onClick={onClick}
    onPointerDown={(event) => {
      event.preventDefault()
    }}
    style={mobileControlButtonStyle(active)}
    type="button"
  >
    {label}
  </button>
)

const MobileCommandControlsRow = (
  {
    ctrlArmed,
    onKeyPress,
    onToggleCollapsed,
    onToggleCtrl
  }: Pick<MobileTerminalControlsProps, "ctrlArmed" | "onKeyPress" | "onToggleCollapsed" | "onToggleCtrl">
): JSX.Element => (
  <div style={mobileControlsRowStyle}>
    <MobileTerminalControlButton
      label="Esc"
      onClick={() => {
        onKeyPress("escape")
      }}
    />
    <MobileTerminalControlButton
      label="Tab"
      onClick={() => {
        onKeyPress("tab")
      }}
    />
    <MobileTerminalControlButton active={ctrlArmed} label="Ctrl" onClick={onToggleCtrl} />
    <MobileTerminalControlButton
      label="Ctrl+C"
      onClick={() => {
        onKeyPress("ctrl-c")
      }}
    />
    <MobileTerminalControlButton label="Hide" onClick={onToggleCollapsed} />
  </div>
)

const MobileArrowControlsRow = (
  { onKeyPress }: Pick<MobileTerminalControlsProps, "onKeyPress">
): JSX.Element => (
  <div style={mobileArrowRowStyle}>
    {mobileTerminalArrowKeys.map((key) => (
      <MobileTerminalControlButton
        key={key}
        label={mobileTerminalArrowLabels[key]}
        onClick={() => {
          onKeyPress(key)
        }}
      />
    ))}
  </div>
)

const CollapsedMobileTerminalControls = (
  { compactTypingMode, onToggleCollapsed }: Pick<
    MobileTerminalControlsProps,
    "compactTypingMode" | "onToggleCollapsed"
  >
): JSX.Element => (
  <div style={compactTypingMode ? { ...mobileControlsCollapsedStyle, padding: "6px" } : mobileControlsCollapsedStyle}>
    <MobileTerminalControlButton label="Show keys" onClick={onToggleCollapsed} />
  </div>
)

const ExpandedMobileTerminalControls = (props: Omit<MobileTerminalControlsProps, "collapsed">): JSX.Element => (
  <div style={props.compactTypingMode ? { ...mobileControlsStyle, gap: "6px", padding: "6px" } : mobileControlsStyle}>
    <MobileCommandControlsRow
      ctrlArmed={props.ctrlArmed}
      onKeyPress={props.onKeyPress}
      onToggleCollapsed={props.onToggleCollapsed}
      onToggleCtrl={props.onToggleCtrl}
    />
    <MobileArrowControlsRow onKeyPress={props.onKeyPress} />
  </div>
)

export const MobileTerminalControls = (props: MobileTerminalControlsProps): JSX.Element =>
  props.collapsed
    ? (
      <CollapsedMobileTerminalControls
        compactTypingMode={props.compactTypingMode}
        onToggleCollapsed={props.onToggleCollapsed}
      />
    )
    : (
      <ExpandedMobileTerminalControls
        compactTypingMode={props.compactTypingMode}
        ctrlArmed={props.ctrlArmed}
        onKeyPress={props.onKeyPress}
        onToggleCollapsed={props.onToggleCollapsed}
        onToggleCtrl={props.onToggleCtrl}
      />
    )
