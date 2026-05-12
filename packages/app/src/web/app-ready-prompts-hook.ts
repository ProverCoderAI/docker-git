import { useEffect, useState } from "react"

import { loadSelectedProjectPrompts } from "./actions.js"
import type { BrowserActionContext } from "./actions.js"
import type { ProjectPromptsSnapshot } from "./api.js"
import type { BrowserMenuTag } from "./menu.js"
import type { BrowserScreen } from "./screen.js"

type PromptsPanelAutoloadArgs = {
  readonly activeScreen: BrowserScreen
  readonly context: BrowserActionContext
  readonly currentMenu: BrowserMenuTag
  readonly selectedProjectId: string | null
}

export const useProjectPromptsState = () => {
  const [projectPrompts, setProjectPrompts] = useState<ProjectPromptsSnapshot | null>(null)

  return { projectPrompts, setProjectPrompts }
}

export const useProjectPromptsReset = (
  selectedProjectId: string | null,
  setProjectPrompts: (value: ProjectPromptsSnapshot | null) => void
) => {
  useEffect(() => {
    setProjectPrompts(null)
  }, [selectedProjectId, setProjectPrompts])
}

export const maybeLoadProjectPrompts = (
  { activeScreen, context, currentMenu, selectedProjectId }: PromptsPanelAutoloadArgs
): void => {
  if (activeScreen.tag === "ProjectPicker" && currentMenu === "Prompts" && selectedProjectId !== null) {
    loadSelectedProjectPrompts(context, { silent: true })
  }
}
