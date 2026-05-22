import type { MainPanelsProps } from "./app-ready-main-panels.js"

const actionLabels: Record<MainPanelsProps["currentMenu"], string> = {
  Auth: "Run",
  Browser: "Open browser",
  Create: "Run",
  Databases: "Open SQL editor",
  Delete: "Delete project",
  Down: "Stop project",
  DownAll: "Run",
  Info: "Run",
  Logs: "Load logs",
  Ports: "Open port",
  ProjectAuth: "Open project auth",
  Prompts: "Refresh prompts",
  Quit: "Run",
  Select: "Open SSH",
  Share: "Start tunnel",
  Skills: "Refresh skills",
  Status: "Load status",
  Tasks: "Refresh tasks"
}

export const actionLabel = (menu: MainPanelsProps["currentMenu"]): string => actionLabels[menu]

export const screenTitle = (props: Pick<MainPanelsProps, "activeScreen" | "currentMenu">): string => {
  if (props.activeScreen.tag === "Create") {
    return "docker-git / Create"
  }
  if (props.activeScreen.tag === "Auth") {
    return "docker-git / Auth profiles"
  }
  if (props.activeScreen.tag === "Share") {
    return "docker-git / Share"
  }
  if (props.activeScreen.tag === "ProjectAuth") {
    return "docker-git / Project auth"
  }
  if (props.activeScreen.tag === "Output") {
    return props.currentMenu === "Logs" ? "docker compose logs" : "docker compose ps"
  }
  if (props.activeScreen.tag === "ProjectPicker") {
    return `docker-git / ${actionLabel(props.currentMenu)}`
  }
  return "docker-git"
}
