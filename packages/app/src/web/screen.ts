import type { BrowserMenuTag } from "./menu.js"

export type BrowserProjectMenuTag = Extract<
  BrowserMenuTag,
  "Browser" | "Databases" | "Delete" | "Down" | "Info" | "Logs" | "Ports" | "ProjectAuth" | "Select" | "Status"
>

export type BrowserScreen =
  | { readonly tag: "Menu" }
  | { readonly tag: "Create" }
  | { readonly tag: "Auth" }
  | { readonly tag: "ProjectPicker" }
  | { readonly tag: "ProjectAuth" }
  | { readonly tag: "Output" }

export const menuScreen = (): BrowserScreen => ({ tag: "Menu" })

export const outputScreen = (): BrowserScreen => ({ tag: "Output" })

export const projectPickerScreen = (): BrowserScreen => ({ tag: "ProjectPicker" })

const projectMenuTags: ReadonlySet<BrowserMenuTag> = new Set<BrowserMenuTag>([
  "Browser",
  "Databases",
  "Delete",
  "Down",
  "Info",
  "Logs",
  "Ports",
  "ProjectAuth",
  "Select",
  "Status"
])

export const isProjectMenu = (menu: BrowserMenuTag): menu is BrowserProjectMenuTag => projectMenuTags.has(menu)

export const screenForMenu = (menu: BrowserMenuTag): BrowserScreen => {
  if (menu === "Create") {
    return { tag: "Create" }
  }
  if (menu === "Auth") {
    return { tag: "Auth" }
  }
  if (isProjectMenu(menu)) {
    return projectPickerScreen()
  }
  return menuScreen()
}
