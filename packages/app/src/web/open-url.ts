export type PreparedOpenUrl = {
  readonly close: () => void
  readonly navigate: (url: string) => boolean
}

export const openUrl = (url: string): boolean => {
  if (typeof globalThis.open === "function") {
    const openedWindow = globalThis.open(url, "_blank", "noopener")
    return openedWindow !== null
  }
  return false
}

const blockedPreparedOpenUrl = (): PreparedOpenUrl => ({
  close: () => {},
  navigate: openUrl
})

export const prepareOpenUrl = (): PreparedOpenUrl => {
  if (typeof globalThis.open !== "function") {
    return blockedPreparedOpenUrl()
  }
  const openedWindow = globalThis.open("about:blank", "_blank")
  if (openedWindow === null) {
    return blockedPreparedOpenUrl()
  }
  openedWindow.opener = null
  return {
    close: () => {
      openedWindow.close()
    },
    navigate: (url) => {
      openedWindow.location.href = url
      openedWindow.focus()
      return true
    }
  }
}
