import { menuItems } from "../docker-git/menu-types.js"

export type BrowserMenuTag =
  | "Create"
  | "Select"
  | "Auth"
  | "ProjectAuth"
  | "Prompts"
  | "Skills"
  | "Info"
  | "Share"
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

export const browserMenuOrder: ReadonlyArray<BrowserMenuTag> = [
  "Create",
  "Select",
  "Auth",
  "ProjectAuth",
  "Prompts",
  "Skills",
  "Info",
  "Share",
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

export const browserMenuItems = browserMenuOrder.map((tag) => ({
  tag,
  label: menuItems.find((item) => item.id._tag === tag)?.label ?? tag
}))

export const browserMenuIndex = (tag: BrowserMenuTag): number => {
  const index = browserMenuItems.findIndex((item) => item.tag === tag)
  return index === -1 ? 0 : index
}
