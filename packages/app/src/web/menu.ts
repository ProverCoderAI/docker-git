import { menuItems } from "../docker-git/menu-types.js"

export type BrowserMenuTag =
  | "Create"
  | "Select"
  | "Auth"
  | "ProjectAuth"
  | "Info"
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
  "Info",
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
