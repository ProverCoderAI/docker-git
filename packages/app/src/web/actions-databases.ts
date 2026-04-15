import { Effect } from "effect"

import {
  type BrowserActionContext,
  confirmAction,
  nullableValue,
  requireSelectedProjectId,
  withBusy,
  withSelectedProjectBusy
} from "./actions-shared.js"
import {
  deleteProjectDatabaseForward,
  deleteProjectDatabaseProfile,
  exposeProjectDatabaseProfile,
  loadProjectDatabaseForwards,
  loadProjectDatabaseProfiles,
  loadProjectDatabaseSession,
  openProjectDatabaseEditor,
  projectDatabaseEditorUrl,
  projectDatabaseExternalUrl,
  type ProjectDatabaseForward,
  type ProjectDatabaseProfile,
  type ProjectDatabaseSession,
  restartProjectDatabaseEditor,
  saveProjectDatabaseProfile
} from "./api.js"
import { openUrl } from "./open-url.js"

const requireSelectedProjectIdForDatabases = (context: BrowserActionContext): string | null => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    context.setDatabaseForwards([])
    context.setDatabaseProfiles([])
    context.setDatabaseSession(null)
  }
  return projectId
}

const databaseStatusMessage = (
  forwards: ReadonlyArray<ProjectDatabaseForward>,
  profiles: ReadonlyArray<ProjectDatabaseProfile>,
  session: ProjectDatabaseSession
): string =>
  session.status === "running"
    ? `SQL editor is available at ${
      projectDatabaseEditorUrl(session)
    }. Profiles: ${profiles.length}. External access: ${forwards.length}.`
    : `SQL editor is ${session.status}. Profiles: ${profiles.length}. External access: ${forwards.length}.`

export const loadSelectedProjectDatabases = (
  context: BrowserActionContext,
  options?: { readonly silent?: boolean }
) => {
  const projectId = requireSelectedProjectIdForDatabases(context)
  if (projectId === null) {
    return
  }
  withBusy({
    context,
    effect: Effect.all({
      forwards: loadProjectDatabaseForwards(projectId),
      profiles: loadProjectDatabaseProfiles(projectId),
      session: loadProjectDatabaseSession(projectId)
    }),
    label: "Loading databases",
    onSuccess: ({ forwards, profiles, session }) => {
      context.setDatabaseForwards(forwards)
      context.setDatabaseProfiles(profiles)
      context.setDatabaseSession(session)
      if (options?.silent !== true) {
        context.setMessage(databaseStatusMessage(forwards, profiles, session))
      }
    }
  })
}

export const saveSelectedDatabaseProfile = (context: BrowserActionContext) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    return
  }
  const connectionString = context.databaseConnectionInput.trim()
  if (connectionString.length === 0) {
    context.setMessage("Paste a Postgres, MySQL, or MariaDB CONNECTION_STRING first.")
    return
  }
  withBusy({
    context,
    effect: saveProjectDatabaseProfile(projectId, connectionString, nullableValue(context.databaseLabelInput)),
    label: "Saving database profile",
    onSuccess: (profile) => {
      context.setDatabaseProfiles((current) => [
        profile,
        ...current.filter((item) => item.id !== profile.id)
      ])
      context.setDatabaseConnectionInput("")
      context.setDatabaseLabelInput("")
      context.setMessage(`Saved database profile: ${profile.label}.`)
    }
  })
}

export const deleteSelectedDatabaseProfile = (
  context: BrowserActionContext,
  profile: ProjectDatabaseProfile
) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null || !confirmAction(`Delete database profile ${profile.label}?`)) {
    return
  }
  withBusy({
    context,
    effect: deleteProjectDatabaseProfile(projectId, profile.id),
    label: "Deleting database profile",
    onSuccess: () => {
      context.setDatabaseForwards((current) => current.filter((item) => item.profileId !== profile.id))
      context.setDatabaseProfiles((current) => current.filter((item) => item.id !== profile.id))
      context.setMessage(`Deleted database profile: ${profile.label}.`)
    }
  })
}

export const exposeSelectedDatabaseProfile = (
  context: BrowserActionContext,
  profile: ProjectDatabaseProfile
) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    return
  }
  withBusy({
    context,
    effect: exposeProjectDatabaseProfile(projectId, profile.id),
    label: "Exposing database TCP access",
    onSuccess: (forward) => {
      context.setDatabaseForwards((current) => [
        forward,
        ...current.filter((item) => item.profileId !== forward.profileId)
      ])
      context.setMessage(
        `Database is available at ${projectDatabaseExternalUrl(forward)} (${forward.maskedExternalConnectionString}).`
      )
    }
  })
}

export const closeSelectedDatabaseForward = (
  context: BrowserActionContext,
  profile: ProjectDatabaseProfile
) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null || !confirmAction(`Close external access for ${profile.label}?`)) {
    return
  }
  withBusy({
    context,
    effect: deleteProjectDatabaseForward(projectId, profile.id),
    label: "Closing database TCP access",
    onSuccess: () => {
      context.setDatabaseForwards((current) => current.filter((item) => item.profileId !== profile.id))
      context.setMessage(`Closed external database access: ${profile.label}.`)
    }
  })
}

export const openSelectedProjectDatabaseEditor = (context: BrowserActionContext) => {
  withSelectedProjectBusy({
    context,
    effect: openProjectDatabaseEditor,
    label: "Opening SQL editor",
    onMissing: () => {},
    onSuccess: (session) => {
      context.setDatabaseSession(session)
      const editorUrl = projectDatabaseEditorUrl(session)
      context.setMessage(
        openUrl(editorUrl)
          ? `SQL editor opened: ${editorUrl}.`
          : `Popup was blocked. Open ${editorUrl} manually.`
      )
    }
  })
}

export const restartSelectedProjectDatabaseEditor = (context: BrowserActionContext) => {
  withSelectedProjectBusy({
    context,
    effect: restartProjectDatabaseEditor,
    label: "Restarting SQL editor",
    onMissing: () => {},
    onSuccess: (session) => {
      context.setDatabaseSession(session)
      context.setMessage(`SQL editor restarted: ${projectDatabaseEditorUrl(session)}.`)
    }
  })
}
