import { useEffect, useState } from "react"

import { loadSelectedProjectPorts } from "./actions.js"
import type { BrowserActionContext } from "./actions.js"
import type { ProjectPortForward } from "./api.js"
import type { BrowserMenuTag } from "./menu.js"
import type { BrowserScreen } from "./screen.js"

type PortForwardPanelAutoloadArgs = {
  readonly activeScreen: BrowserScreen
  readonly context: BrowserActionContext
  readonly currentMenu: BrowserMenuTag
  readonly selectedProjectId: string | null
}

export const usePortForwardState = () => {
  const [portForwardInput, setPortForwardInput] = useState("")
  const [portForwards, setPortForwards] = useState<ReadonlyArray<ProjectPortForward>>([])

  return { portForwardInput, portForwards, setPortForwardInput, setPortForwards }
}

export const useProjectPortForwardsReset = (
  selectedProjectId: string | null,
  setPortForwardInput: (value: string) => void,
  setPortForwards: (value: ReadonlyArray<ProjectPortForward>) => void
) => {
  useEffect(() => {
    setPortForwardInput("")
    setPortForwards([])
  }, [selectedProjectId, setPortForwardInput, setPortForwards])
}

export const maybeLoadProjectPortForwards = (
  { activeScreen, context, currentMenu, selectedProjectId }: PortForwardPanelAutoloadArgs
): void => {
  if (activeScreen.tag === "ProjectPicker" && currentMenu === "Ports" && selectedProjectId !== null) {
    loadSelectedProjectPorts(context, { silent: true })
  }
}
