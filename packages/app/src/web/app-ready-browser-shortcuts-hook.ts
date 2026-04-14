import { useEffect, useEffectEvent } from "react"

import { type BrowserShortcutArgs, dispatchBrowserShortcut } from "./app-ready-shortcut-runtime.js"

export const useBrowserShortcuts = ({ ...args }: BrowserShortcutArgs) => {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    dispatchBrowserShortcut(event, args)
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      onKeyDown(event)
    }
    globalThis.addEventListener("keydown", handleKeyDown)
    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown)
    }
  }, [onKeyDown])
}
