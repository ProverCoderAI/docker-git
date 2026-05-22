import type { ReadyLayoutProps } from "./app-ready-layout.js"
import type { ActiveTerminalSession } from "./terminal.js"

export type TerminalWorkspaceView = "terminal" | "tasks"

export type TerminalScreenProps = Pick<
  ReadyLayoutProps,
  | "activeTerminalSessionId"
  | "onApplyProjectById"
  | "onOpenProjectBrowserById"
  | "onOpenProjectTaskManagerById"
  | "onOpenProjectTerminalById"
  | "onOpenSkiller"
  | "onAuthTerminalExitSuccess"
  | "onLoadProjectTaskLogs"
  | "onProjectTasksIncludeDefaultChange"
  | "onRefreshProjectTasks"
  | "onSelectTerminal"
  | "onSetActiveScreen"
  | "onStopProjectTask"
  | "onTerminalClose"
  | "onTerminalMessage"
  | "project"
  | "projectBrowser"
  | "projectTaskLogs"
  | "projectTasks"
  | "projectTasksIncludeDefault"
  | "selectedProjectSummary"
  | "terminalSessions"
  | "viewportLayout"
>

export type TerminalPaneProps =
  & Pick<
    TerminalScreenProps,
    | "onApplyProjectById"
    | "onOpenProjectBrowserById"
    | "onOpenProjectTaskManagerById"
    | "onOpenProjectTerminalById"
    | "onOpenSkiller"
    | "onAuthTerminalExitSuccess"
    | "onLoadProjectTaskLogs"
    | "onProjectTasksIncludeDefaultChange"
    | "onRefreshProjectTasks"
    | "onSetActiveScreen"
    | "onStopProjectTask"
    | "onTerminalClose"
    | "onTerminalMessage"
    | "project"
    | "projectBrowser"
    | "projectTaskLogs"
    | "projectTasks"
    | "projectTasksIncludeDefault"
    | "selectedProjectSummary"
    | "viewportLayout"
  >
  & {
    readonly taskManagerOpen: boolean
    readonly onCloseTaskManager: () => void
    readonly singleSession: boolean
    readonly terminalSession: ActiveTerminalSession
  }
