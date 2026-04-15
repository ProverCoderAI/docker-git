import { useEffect, useState } from "react"

import { loadSelectedProjectDatabases } from "./actions.js"
import type { BrowserActionContext } from "./actions.js"
import type { ProjectDatabaseForward, ProjectDatabaseProfile, ProjectDatabaseSession } from "./api.js"
import type { BrowserMenuTag } from "./menu.js"
import type { BrowserScreen } from "./screen.js"

type DatabasePanelAutoloadArgs = {
  readonly activeScreen: BrowserScreen
  readonly context: BrowserActionContext
  readonly currentMenu: BrowserMenuTag
  readonly selectedProjectId: string | null
}

type ProjectDatabasesResetArgs = {
  readonly selectedProjectId: string | null
  readonly setDatabaseConnectionInput: (value: string) => void
  readonly setDatabaseForwards: (value: ReadonlyArray<ProjectDatabaseForward>) => void
  readonly setDatabaseLabelInput: (value: string) => void
  readonly setDatabaseProfiles: (value: ReadonlyArray<ProjectDatabaseProfile>) => void
  readonly setDatabaseSession: (value: ProjectDatabaseSession | null) => void
}

export const useDatabaseState = () => {
  const [databaseConnectionInput, setDatabaseConnectionInput] = useState("")
  const [databaseForwards, setDatabaseForwards] = useState<ReadonlyArray<ProjectDatabaseForward>>([])
  const [databaseLabelInput, setDatabaseLabelInput] = useState("")
  const [databaseProfiles, setDatabaseProfiles] = useState<ReadonlyArray<ProjectDatabaseProfile>>([])
  const [databaseSession, setDatabaseSession] = useState<ProjectDatabaseSession | null>(null)

  return {
    databaseConnectionInput,
    databaseForwards,
    databaseLabelInput,
    databaseProfiles,
    databaseSession,
    setDatabaseConnectionInput,
    setDatabaseForwards,
    setDatabaseLabelInput,
    setDatabaseProfiles,
    setDatabaseSession
  }
}

export const useProjectDatabasesReset = ({
  selectedProjectId,
  setDatabaseConnectionInput,
  setDatabaseForwards,
  setDatabaseLabelInput,
  setDatabaseProfiles,
  setDatabaseSession
}: ProjectDatabasesResetArgs) => {
  useEffect(() => {
    setDatabaseConnectionInput("")
    setDatabaseForwards([])
    setDatabaseLabelInput("")
    setDatabaseProfiles([])
    setDatabaseSession(null)
  }, [
    selectedProjectId,
    setDatabaseConnectionInput,
    setDatabaseForwards,
    setDatabaseLabelInput,
    setDatabaseProfiles,
    setDatabaseSession
  ])
}

export const maybeLoadProjectDatabases = (
  { activeScreen, context, currentMenu, selectedProjectId }: DatabasePanelAutoloadArgs
): void => {
  if (activeScreen.tag === "ProjectPicker" && currentMenu === "Databases" && selectedProjectId !== null) {
    loadSelectedProjectDatabases(context, { silent: true })
  }
}
