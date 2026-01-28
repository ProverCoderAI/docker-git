const logNode = document.querySelector("[data-deploy-log]")
const statusNode = document.querySelector("[data-deploy-status]")
const messageNode = document.querySelector("[data-deploy-message]")
const updatedNode = document.querySelector("[data-deploy-updated]")

if (!logNode) {
  return
}

const projectId = logNode.dataset.projectId
if (!projectId) {
  return
}

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

const applyStatus = (status) => {
  if (!status || !statusNode) {
    return
  }

  const phase = typeof status.phase === "string" ? status.phase : "idle"
  const label = phaseLabels[phase] ?? "idle"
  const className = phaseClasses[phase] ?? phaseClasses.idle
  statusNode.textContent = label
  statusNode.className = `deploy-badge ${className}`

  if (messageNode) {
    messageNode.textContent = status.message ?? ""
  }

  if (updatedNode) {
    updatedNode.textContent = status.updatedAt ?? ""
  }
}

const formatEntry = (entry) => `${entry.timestamp} ${entry.line}`

const applySnapshot = (payload) => {
  if (!payload || !Array.isArray(payload.entries)) {
    return
  }

  const lines = payload.entries.map(formatEntry)
  logNode.textContent = lines.length === 0 ? "(no output)" : `${lines.join("\n")}\n`
  applyStatus(payload.status)
}

const appendLog = (entry) => {
  if (!entry || typeof entry.timestamp !== "string") {
    return
  }
  const nextLine = formatEntry(entry)
  const current = logNode.textContent ?? ""
  if (current.trim().length === 0 || current.trim() === "(no output)") {
    logNode.textContent = `${nextLine}\n`
  } else {
    logNode.textContent = `${current.replace(/\s*$/, "")}\n${nextLine}\n`
  }
}

const source = new EventSource(`/api/deployments/${encodeURIComponent(projectId)}/stream`)

source.addEventListener("snapshot", (event) => {
  try {
    const payload = JSON.parse(event.data)
    applySnapshot(payload)
  } catch {
    // ignore
  }
})

source.addEventListener("log", (event) => {
  try {
    const entry = JSON.parse(event.data)
    appendLog(entry)
  } catch {
    // ignore
  }
})

source.addEventListener("status", (event) => {
  try {
    const status = JSON.parse(event.data)
    applyStatus(status)
  } catch {
    // ignore
  }
})

source.addEventListener("error", () => {
  if (messageNode) {
    messageNode.textContent = "stream disconnected"
  }
})
