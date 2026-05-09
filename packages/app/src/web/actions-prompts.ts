import { type BrowserActionContext, requireSelectedProjectId, withBusy } from "./actions-shared.js"
import { deleteProjectPrompt, loadProjectPrompts, writeProjectPrompt } from "./api.js"
import type { ProjectPromptKind } from "./api.js"

const requireProjectIdForPrompts = (context: BrowserActionContext): string | null => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    context.setProjectPrompts(null)
  }
  return projectId
}

export const loadSelectedProjectPrompts = (
  context: BrowserActionContext,
  options?: { readonly silent?: boolean }
) => {
  const projectId = requireProjectIdForPrompts(context)
  if (projectId === null) {
    return
  }
  withBusy({
    context,
    effect: loadProjectPrompts(projectId),
    label: "Loading project prompts",
    onSuccess: (snapshot) => {
      context.setProjectPrompts(snapshot)
      if (options?.silent !== true) {
        context.setMessage(`Loaded prompts for ${snapshot.projectKey}.`)
      }
    }
  })
}

export const saveSelectedProjectPrompt = (
  context: BrowserActionContext,
  kind: ProjectPromptKind,
  content: string
) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    return
  }
  withBusy({
    context,
    effect: writeProjectPrompt(projectId, kind, content),
    label: `Saving ${kind} prompt`,
    onSuccess: (snapshot) => {
      context.setProjectPrompts(snapshot)
      context.setMessage(`Saved ${kind} prompt.`)
    }
  })
}

export const deleteSelectedProjectPrompt = (
  context: BrowserActionContext,
  kind: ProjectPromptKind
) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    return
  }
  withBusy({
    context,
    effect: deleteProjectPrompt(projectId, kind),
    label: `Deleting ${kind} prompt`,
    onSuccess: (snapshot) => {
      context.setProjectPrompts(snapshot)
      context.setMessage(`Deleted ${kind} prompt.`)
    }
  })
}
