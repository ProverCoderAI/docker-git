import type { JSX } from "react"

import {
  closeButtonStyle,
  compactCloseButtonStyle,
  compactHeaderActionsStyle,
  compactHeaderStyle,
  compactHeaderTitleStyle,
  compactStatusStyle,
  headerActionsStyle,
  headerStatusStyle,
  headerStyle,
  headerSubtitleStyle,
  headerTitleStyle
} from "./panel-terminal-styles.js"
import type { TerminalPanelProps } from "./panel-terminal-types.js"
import type { TerminalStatus } from "./terminal-panel-runtime.js"

type TerminalHeaderProps =
  & Pick<
    TerminalPanelProps,
    | "onApplyProject"
    | "onDetach"
    | "onKill"
    | "onOpenBrowser"
    | "onOpenSkiller"
    | "onOpenTaskManager"
    | "onOpenTerminal"
    | "session"
  >
  & {
    readonly compactHeaderMode: boolean
    readonly inlineImagePreviewsEnabled: boolean
    readonly onToggleInlineImagePreviews: () => void
    readonly status: TerminalStatus
  }

type TerminalActionDescriptor = {
  readonly compactLabel: string
  readonly label: string
  readonly onClick: (() => void) | undefined
}

const TerminalHeaderTitle = (
  {
    compactHeaderMode,
    session,
    status
  }: Pick<TerminalPanelProps, "session"> & {
    readonly compactHeaderMode: boolean
    readonly status: TerminalStatus
  }
): JSX.Element =>
  compactHeaderMode
    ? (
      <div style={{ alignItems: "center", display: "flex", gap: "6px", minWidth: 0 }}>
        <div style={compactHeaderTitleStyle}>
          {session.browserProjectName ?? session.header}
        </div>
        <div style={compactStatusStyle(status)}>{status}</div>
      </div>
    )
    : (
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0, width: "100%" }}>
        <div style={headerTitleStyle}>{session.header}</div>
        <div style={headerStatusStyle(status)}>{status}</div>
        <div style={headerSubtitleStyle}>{session.subtitle}</div>
      </div>
    )

const TerminalActionButton = (
  {
    children,
    compactTypingMode,
    onClick,
    pressed,
    title
  }: {
    readonly children: string
    readonly compactTypingMode: boolean
    readonly onClick: () => void
    readonly pressed?: boolean
    readonly title?: string
  }
): JSX.Element => (
  <button
    aria-pressed={pressed}
    onClick={onClick}
    style={compactTypingMode ? compactCloseButtonStyle : closeButtonStyle}
    title={title}
    type="button"
  >
    {children}
  </button>
)

const optionalProjectActions = (
  props: TerminalHeaderProps
): ReadonlyArray<TerminalActionDescriptor> => {
  if (props.session.browserProjectId === undefined) {
    return []
  }
  return [
    { compactLabel: "Browser", label: "Open browser", onClick: props.onOpenBrowser },
    { compactLabel: "Skiller", label: "Skiller", onClick: props.onOpenSkiller },
    { compactLabel: "Apply", label: "Apply", onClick: props.onApplyProject },
    { compactLabel: "Tasks", label: "Task manager", onClick: props.onOpenTaskManager },
    { compactLabel: "New", label: "New terminal", onClick: props.onOpenTerminal }
  ]
}

const TerminalProjectActionButtons = (
  {
    actions,
    compactHeaderMode
  }: {
    readonly actions: ReadonlyArray<TerminalActionDescriptor>
    readonly compactHeaderMode: boolean
  }
): JSX.Element => (
  <>
    {actions.map((action) =>
      action.onClick === undefined
        ? null
        : (
          <TerminalActionButton
            key={action.label}
            compactTypingMode={compactHeaderMode}
            onClick={action.onClick}
          >
            {compactHeaderMode ? action.compactLabel : action.label}
          </TerminalActionButton>
        )
    )}
  </>
)

const TerminalImageToggleButton = (
  {
    compactHeaderMode,
    inlineImagePreviewsEnabled,
    onToggleInlineImagePreviews
  }: Pick<TerminalHeaderProps, "compactHeaderMode" | "inlineImagePreviewsEnabled" | "onToggleInlineImagePreviews">
): JSX.Element => {
  const label = inlineImagePreviewsEnabled ? "Images on" : "Images off"
  const compactLabel = inlineImagePreviewsEnabled ? "Img on" : "Img off"
  const title = inlineImagePreviewsEnabled
    ? "Automatic image previews enabled"
    : "Automatic image previews disabled"

  return (
    <TerminalActionButton
      compactTypingMode={compactHeaderMode}
      onClick={onToggleInlineImagePreviews}
      pressed={inlineImagePreviewsEnabled}
      title={title}
    >
      {compactHeaderMode ? compactLabel : label}
    </TerminalActionButton>
  )
}

const TerminalHeaderActions = (props: TerminalHeaderProps): JSX.Element => (
  <div style={props.compactHeaderMode ? compactHeaderActionsStyle : headerActionsStyle}>
    <TerminalProjectActionButtons actions={optionalProjectActions(props)} compactHeaderMode={props.compactHeaderMode} />
    <TerminalImageToggleButton
      compactHeaderMode={props.compactHeaderMode}
      inlineImagePreviewsEnabled={props.inlineImagePreviewsEnabled}
      onToggleInlineImagePreviews={props.onToggleInlineImagePreviews}
    />
    <TerminalActionButton compactTypingMode={props.compactHeaderMode} onClick={props.onDetach}>
      Detach
    </TerminalActionButton>
    <TerminalActionButton compactTypingMode={props.compactHeaderMode} onClick={props.onKill}>
      Kill
    </TerminalActionButton>
  </div>
)

export const TerminalHeader = (props: TerminalHeaderProps): JSX.Element => (
  <div style={props.compactHeaderMode ? compactHeaderStyle : headerStyle}>
    <TerminalHeaderTitle
      compactHeaderMode={props.compactHeaderMode}
      session={props.session}
      status={props.status}
    />
    <TerminalHeaderActions {...props} />
  </div>
)
