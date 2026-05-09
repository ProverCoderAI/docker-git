import * as ParseResult from "@effect/schema/ParseResult"
import { Either } from "effect"

import { createProjectDraftFromInputs } from "../docker-git/menu-create-shared.js"
import type { CreateInputs } from "../docker-git/menu-types.js"
import { readEventPayloadString } from "./actions-event-payload.js"
import { appendOutputLine, appendOutputLineHandler, notifyProjectEventRateLimit } from "./actions-output.js"
import { type BrowserActionContext, withBusy } from "./actions-shared.js"
import { ProjectDetailsSchema } from "./api-schema.js"
import { type ApiEvent, loadProjectDetails, type ProjectDetails, startCreateProject } from "./api.js"
import { openProjectEventStream } from "./project-events.js"
import { outputScreen, projectPickerScreen } from "./screen.js"

const readCreatedProjectId = (event: ApiEvent): string | null =>
  event.type === "project.created" ? readEventPayloadString(event, "projectId") : null

const readCreatedProject = (event: ApiEvent): ProjectDetails | null => {
  if (event.type !== "project.created") {
    return null
  }
  const payload = event.payload
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return null
  }
  const project = Object.entries(payload).find(([name]) => name === "project")?.[1]
  return Either.match(ParseResult.decodeUnknownEither(ProjectDetailsSchema)(project), {
    onLeft: () => null,
    onRight: (value) => value
  })
}

const readCreateFailureMessage = (event: ApiEvent): string | null =>
  event.type === "project.deployment.status" && readEventPayloadString(event, "phase") === "failed"
    ? (readEventPayloadString(event, "message") ?? "Project creation failed.")
    : null

const applyCreatedProject = (
  context: BrowserActionContext,
  project: ProjectDetails
) => {
  context.reloadDashboard()
  context.setProjectAuthSnapshot(null)
  context.setSelectedMenuIndex(1)
  context.setActiveScreen(projectPickerScreen())
  context.setSelectedProject(project)
  context.setSelectedProjectId(project.id)
  context.setMessage(`Created ${project.displayName}.`)
}

const finishCreateFromEvent = (
  context: BrowserActionContext,
  projectId: string,
  project: ProjectDetails | null
) => {
  appendOutputLine(context, "[create] Project created")
  if (project !== null) {
    applyCreatedProject(context, project)
    return
  }
  withBusy({
    context,
    effect: loadProjectDetails(projectId),
    label: "Loading created project",
    onFailure: (error) => {
      appendOutputLine(context, `[error] ${error}`)
    },
    onSuccess: (project) => {
      applyCreatedProject(context, project)
    }
  })
}

export const submitCreateInputs = (
  inputs: CreateInputs,
  context: BrowserActionContext
) => {
  context.setOutput("")
  context.setActiveScreen(outputScreen())
  appendOutputLine(context, "[create] Project creation requested")
  withBusy({
    context,
    effect: startCreateProject(createProjectDraftFromInputs(inputs)),
    label: "Starting project",
    onFailure: (error) => {
      appendOutputLine(context, `[error] ${error}`)
    },
    onSuccess: (accepted) => {
      appendOutputLine(context, `[create] Project accepted: ${accepted.projectId}`)
      context.setMessage("Project creation is running. Live logs are open.")
      let stream: ReturnType<typeof openProjectEventStream> | null = null
      stream = openProjectEventStream(accepted.projectId, {
        initialCursor: accepted.cursor,
        onEvent: (event) => {
          const failureMessage = readCreateFailureMessage(event)
          if (failureMessage !== null) {
            stream?.close()
            appendOutputLine(context, `[error] ${failureMessage}`)
            context.setMessage(failureMessage)
            return
          }

          const projectId = readCreatedProjectId(event)
          if (projectId !== null) {
            stream?.close()
            finishCreateFromEvent(context, projectId, readCreatedProject(event))
          }
        },
        onLine: appendOutputLineHandler(context),
        onRateLimit: () => {
          notifyProjectEventRateLimit(context)
        }
      })
    }
  })
}
