import type { CSSProperties, JSX } from "react"

import type { TerminalScreenProps } from "./app-ready-terminal-types.js"
import { TaskPanel } from "./panel-tasks.js"

const taskManagerBodyStyle: CSSProperties = {
  background: "#080a0d",
  boxSizing: "border-box",
  color: "#d6e5f7",
  height: "100%",
  overflow: "auto",
  padding: "10px"
}

const taskManagerToolbarStyle: CSSProperties = {
  alignItems: "center",
  display: "flex",
  justifyContent: "flex-end",
  marginBottom: "10px"
}

const taskManagerReturnButtonStyle: CSSProperties = {
  background: "#171d24",
  border: "1px solid #3a4652",
  borderRadius: "8px",
  color: "#d6e5f7",
  cursor: "pointer",
  font: "inherit",
  padding: "6px 10px"
}

export const TerminalTaskManagerBody = (
  props:
    & Pick<
      TerminalScreenProps,
      | "onLoadProjectTaskLogs"
      | "onProjectTasksIncludeDefaultChange"
      | "onRefreshProjectTasks"
      | "onStopProjectTask"
      | "project"
      | "projectTaskLogs"
      | "projectTasks"
      | "projectTasksIncludeDefault"
      | "selectedProjectSummary"
    >
    & {
      readonly onClose: () => void
    }
): JSX.Element => (
  <div style={taskManagerBodyStyle}>
    <div style={taskManagerToolbarStyle}>
      <button onClick={props.onClose} style={taskManagerReturnButtonStyle} type="button">
        Terminal
      </button>
    </div>
    <TaskPanel
      includeDefault={props.projectTasksIncludeDefault}
      logs={props.projectTaskLogs}
      onIncludeDefaultChange={props.onProjectTasksIncludeDefaultChange}
      onLoadLogs={props.onLoadProjectTaskLogs}
      onRefreshTasks={props.onRefreshProjectTasks}
      onStopTask={props.onStopProjectTask}
      project={props.project}
      selectedProjectSummary={props.selectedProjectSummary}
      snapshot={props.projectTasks}
    />
  </div>
)
