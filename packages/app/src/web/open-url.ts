export type PreparedOpenUrl = {
  readonly close: () => void
  readonly navigate: (url: string) => boolean
}

export const didOpenUrl = (url: string): boolean => {
  if (typeof open === "function") {
    const openedWindow = open(url, "_blank", "noopener")
    return openedWindow !== null
  }
  return false
}

const blockedPreparedOpenUrl = (): PreparedOpenUrl => ({
  close: () => {},
  navigate: didOpenUrl
})

export const prepareOpenUrl = (): PreparedOpenUrl => {
  if (typeof open !== "function") {
    return blockedPreparedOpenUrl()
  }
  const openedWindow = open("about:blank", "_blank")
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
