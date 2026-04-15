import {
  closeSelectedDatabaseForward,
  deleteSelectedDatabaseProfile,
  exposeSelectedDatabaseProfile,
  loadSelectedProjectDatabases,
  openSelectedProjectDatabaseEditor,
  restartSelectedProjectDatabaseEditor,
  saveSelectedDatabaseProfile
} from "./actions.js"
import type { createActionContext } from "./app-ready-actions.js"
import type { ReadyState } from "./app-ready-hooks.js"

export const bindDatabaseActions = (
  actionContext: ReturnType<typeof createActionContext>,
  state: ReadyState
) => ({
  onCloseDatabaseForward: (profile: Parameters<typeof closeSelectedDatabaseForward>[1]) => {
    closeSelectedDatabaseForward(actionContext, profile)
  },
  onDatabaseConnectionInputChange: (value: string) => {
    state.setDatabaseConnectionInput(value)
  },
  onDatabaseLabelInputChange: (value: string) => {
    state.setDatabaseLabelInput(value)
  },
  onDeleteDatabaseProfile: (profile: Parameters<typeof deleteSelectedDatabaseProfile>[1]) => {
    deleteSelectedDatabaseProfile(actionContext, profile)
  },
  onExposeDatabaseProfile: (profile: Parameters<typeof exposeSelectedDatabaseProfile>[1]) => {
    exposeSelectedDatabaseProfile(actionContext, profile)
  },
  onOpenProjectDatabaseEditor: () => {
    openSelectedProjectDatabaseEditor(actionContext)
  },
  onRefreshProjectDatabases: () => {
    loadSelectedProjectDatabases(actionContext)
  },
  onRestartProjectDatabaseEditor: () => {
    restartSelectedProjectDatabaseEditor(actionContext)
  },
  onSaveDatabaseProfile: () => {
    saveSelectedDatabaseProfile(actionContext)
  }
})
