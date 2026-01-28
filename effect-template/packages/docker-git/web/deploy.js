const statusNodes = document.querySelectorAll("[data-deploy-status]")
const messageNodes = document.querySelectorAll("[data-deploy-message]")

if (statusNodes.length === 0) {
  return
}

const statusById = new Map()
const messageById = new Map()

statusNodes.forEach((node) => {
  const id = node.dataset.projectId
  if (id && id.length > 0) {
    statusById.set(id, node)
  }
})

messageNodes.forEach((node) => {
  const id = node.dataset.projectId
  if (id && id.length > 0) {
    messageById.set(id, node)
  }
})

const phaseLabels = {
  idle: "idle",
  down: "stopping",
  build: "building",
  up: "starting",
  running: "running",
  error: "error"
}

const phaseClasses = {
  idle: "deploy-badge--idle",
  down: "deploy-badge--down",
  build: "deploy-badge--build",
  up: "deploy-badge--up",
  running: "deploy-badge--running",
  error: "deploy-badge--error"
}

const applyStatus = (projectId, phase, message) => {
  const node = statusById.get(projectId)
  if (!node) {
    return
  }

  const normalized = phaseLabels[phase] ? phase : "idle"
  const className = phaseClasses[phase] ?? phaseClasses.idle
  node.textContent = phaseLabels[normalized] ?? "idle"
  node.className = `deploy-badge ${className}`

  const messageNode = messageById.get(projectId)
  if (messageNode) {
    messageNode.textContent = message ?? ""
  }
}

const applyAll = (payload) => {
  if (!payload || !Array.isArray(payload.deployments)) {
    return
  }

  const seen = new Set()
  payload.deployments.forEach((status) => {
    if (!status || typeof status.projectId !== "string") {
      return
    }
    seen.add(status.projectId)
    applyStatus(status.projectId, status.phase, status.message)
  })

  statusById.forEach((_, projectId) => {
    if (!seen.has(projectId)) {
      applyStatus(projectId, "idle", "")
    }
  })
}

const fetchStatuses = () => {
  const request = new XMLHttpRequest()
  request.open("GET", "/api/deployments")
  request.responseType = "text"
  request.onload = () => {
    if (request.status < 200 || request.status >= 300) {
      return
    }
    try {
      const json = JSON.parse(request.responseText)
      applyAll(json)
    } catch {
      // ignore invalid payloads
    }
  }
  request.send()
}

fetchStatuses()
setInterval(fetchStatuses, 2000)

const actionForms = document.querySelectorAll("form[data-action][data-project-id]")
actionForms.forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault()
    const action = form.dataset.action
    const projectId = form.dataset.projectId
    if (!action || !projectId) {
      return
    }

    if (action === "down") {
      applyStatus(projectId, "down", "docker compose down")
    } else if (action === "recreate") {
      applyStatus(projectId, "build", "docker compose --progress=plain build")
    } else {
      applyStatus(projectId, "build", "docker compose --progress=plain build")
    }

    const request = new XMLHttpRequest()
    request.open("POST", form.action)
    request.onload = () => {
      if (request.status >= 200 && request.status < 400) {
        fetchStatuses()
      } else {
        applyStatus(projectId, "error", "action failed")
      }
    }
    request.onerror = () => {
      applyStatus(projectId, "error", "action failed")
    }
    request.send()
  })
})
