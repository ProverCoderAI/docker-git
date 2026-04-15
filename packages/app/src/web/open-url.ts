export const openUrl = (url: string): boolean => {
  if (typeof globalThis.open === "function") {
    const openedWindow = globalThis.open(url, "_blank", "noopener")
    return openedWindow !== null
  }
  return false
}
