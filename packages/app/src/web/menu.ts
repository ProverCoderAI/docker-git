export type BrowserMenuTag =
  | "Create"
  | "Select"
  | "Auth"
  | "ProjectAuth"
  | "Prompts"
  | "Skills"
  | "Info"
  | "Ports"
  | "Databases"
  | "Tasks"
  | "Browser"
  | "Status"
  | "Logs"
  | "Down"
  | "DownAll"
  | "Delete"
  | "Quit"

const browserMenuOrder: ReadonlyArray<BrowserMenuTag> = [
  "Create",
  "Select",
  "Auth",
  "ProjectAuth",
  "Prompts",
  "Skills",
  "Info",
  "Ports",
  "Databases",
  "Tasks",
  "Browser",
  "Status",
  "Logs",
  "Down",
  "DownAll",
  "Delete",
  "Quit"
]

const browserMenuLabels: Readonly<Record<BrowserMenuTag, string>> = {
  Auth: "Auth profiles (keys)",
  Browser: "Open browser",
  Create: "Create project",
  Databases: "Databases",
  Delete: "Delete project (folder + container)",
  Down: "docker compose down",
  DownAll: "docker compose down (ALL projects)",
  Info: "Show connection info",
  Logs: "docker compose logs --tail=200",
  Ports: "Port forwards",
  ProjectAuth: "Project auth (bind labels)",
  Prompts: "Prompts",
  Quit: "Quit",
  Select: "Select project",
  Skills: "Skills",
  Status: "docker compose ps",
  Tasks: "Tasks"
}

export const browserMenuItems = browserMenuOrder.map((tag) => ({
  tag,
  label: browserMenuLabels[tag]
}))

export const browserMenuIndex = (tag: BrowserMenuTag): number => {
  const index = browserMenuItems.findIndex((item) => item.tag === tag)
  return index === -1 ? 0 : index
}
