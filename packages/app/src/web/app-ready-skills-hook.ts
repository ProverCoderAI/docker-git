import { useEffect, useState } from "react"

import { loadSelectedProjectSkills } from "./actions.js"
import type { BrowserActionContext } from "./actions.js"
import type { ProjectSkillsSnapshot } from "./api.js"
import type { BrowserMenuTag } from "./menu.js"
import type { BrowserScreen } from "./screen.js"

type SkillsPanelAutoloadArgs = {
  readonly activeScreen: BrowserScreen
  readonly context: BrowserActionContext
  readonly currentMenu: BrowserMenuTag
  readonly selectedProjectId: string | null
}

export const useProjectSkillsState = () => {
  const [projectSkills, setProjectSkills] = useState<ProjectSkillsSnapshot | null>(null)

  return { projectSkills, setProjectSkills }
}

export const useProjectSkillsReset = (
  selectedProjectId: string | null,
  setProjectSkills: (value: ProjectSkillsSnapshot | null) => void
) => {
  useEffect(() => {
    setProjectSkills(null)
  }, [selectedProjectId, setProjectSkills])
}

export const maybeLoadProjectSkills = (
  { activeScreen, context, currentMenu, selectedProjectId }: SkillsPanelAutoloadArgs
): void => {
  if (activeScreen.tag === "ProjectPicker" && currentMenu === "Skills" && selectedProjectId !== null) {
    loadSelectedProjectSkills(context, { silent: true })
  }
}
