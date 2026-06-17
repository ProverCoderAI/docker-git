import { type BrowserActionContext, requireSelectedProjectId, withBusy } from "./actions-shared.js"
import {
  createProjectPortForward,
  deleteProjectPortForward,
  loadProjectPortForwards,
  projectPortForwardProxyUrl
} from "./api.js"

const parsePortInput = (value: string): number | null => {
  const trimmed = value.trim()
  if (!/^\d+$/u.test(trimmed)) {
    return null
  }
  const port = Number(trimmed)
  return port > 0 && port <= 65_535 ? port : null
}

const requireProjectIdForPorts = (context: BrowserActionContext): string | null => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    context.setPortForwards([])
  }
  return projectId
}

export const loadSelectedProjectPorts = (
  context: BrowserActionContext,
  options?: { readonly silent?: boolean }
) => {
  const projectId = requireProjectIdForPorts(context)
  if (projectId === null) {
    return
  }
  withBusy({
    context,
    effect: loadProjectPortForwards(projectId),
    label: "Loading project ports",
    onSuccess: (forwards) => {
      context.setPortForwards(forwards)
      if (options?.silent !== true) {
        context.setMessage(`Loaded ${forwards.length} port forward(s).`)
      }
    }
  })
}

export const openSelectedProjectPort = (context: BrowserActionContext) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    return
  }
  const targetPort = parsePortInput(context.portForwardInput)
  if (targetPort === null) {
    context.setMessage("Enter a container port between 1 and 65535.")
    return
  }
  withBusy({
    context,
    effect: createProjectPortForward(projectId, targetPort),
    label: "Opening project port",
    onSuccess: (forward) => {
      context.setPortForwards((current) => [
        forward,
        ...current.filter((item) => item.targetPort !== forward.targetPort)
      ])
      context.setMessage(`Port ${forward.targetPort} is available at ${projectPortForwardProxyUrl(forward)}.`)
    }
  })
}

export const closeSelectedProjectPort = (
  context: BrowserActionContext,
  targetPort: number
) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    return
  }
  withBusy({
    context,
    effect: deleteProjectPortForward(projectId, targetPort),
    label: "Closing project port",
    onSuccess: () => {
      context.setPortForwards((current) => current.filter((item) => item.targetPort !== targetPort))
      context.setMessage(`Port ${targetPort} forward closed.`)
    }
  })
}
