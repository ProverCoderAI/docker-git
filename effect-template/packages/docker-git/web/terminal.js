const terminalRoot = document.getElementById("terminal")

if (!terminalRoot) {
  return
}

const projectId = terminalRoot.dataset.projectId
const codexLabel = terminalRoot.dataset.codexLabel
const wsPort = terminalRoot.dataset.wsPort

const protocol = window.location.protocol === "https:" ? "wss" : "ws"
const host = window.location.hostname
const resolvedPort = wsPort && wsPort.length > 0 ? wsPort : window.location.port
const portSegment = resolvedPort && resolvedPort.length > 0 ? `:${resolvedPort}` : ""

const buildPath = () => {
  if (projectId && projectId.length > 0) {
    return `/term/${encodeURIComponent(projectId)}`
  }
  const safeLabel = codexLabel && codexLabel.length > 0 ? codexLabel : "default"
  return `/codex/${encodeURIComponent(safeLabel)}`
}

const estimateSize = () => {
  const width = terminalRoot.clientWidth || 900
  const height = terminalRoot.clientHeight || 420
  const cols = Math.max(60, Math.floor(width / 8))
  const rows = Math.max(16, Math.floor(height / 18))
  return { cols, rows }
}

const initialSize = estimateSize()
const term = new Terminal({
  cols: initialSize.cols,
  rows: initialSize.rows,
  convertEol: true,
  cursorBlink: true,
  fontFamily: "'IBM Plex Mono', 'JetBrains Mono', 'Menlo', monospace",
  fontSize: 13,
  theme: {
    background: "#0b0d10",
    foreground: "#f5f7ff"
  }
})

term.open(terminalRoot)
term.focus()

const connect = () => {
  const size = estimateSize()
  term.resize(size.cols, size.rows)
  const path = buildPath()
  const wsUrl = `${protocol}://${host}${portSegment}${path}?cols=${size.cols}&rows=${size.rows}`
  const socket = new WebSocket(wsUrl)

  const sendResize = (cols, rows) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "resize", cols, rows }))
    }
  }

  term.onData((data) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "input", data }))
    }
  })

  socket.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data)
      if (payload.type === "output" && typeof payload.data === "string") {
        term.write(payload.data)
      } else if (payload.type === "error") {
        term.writeln(`\r\n[error] ${payload.message ?? "unknown"}\r\n`)
      }
    } catch {
      term.write(event.data)
    }
  }

  socket.onopen = () => {
    const next = estimateSize()
    sendResize(next.cols, next.rows)
  }

  socket.onclose = () => {
    term.writeln("\r\n[terminal disconnected]\r\n")
  }

  window.addEventListener("resize", () => {
    const next = estimateSize()
    term.resize(next.cols, next.rows)
    sendResize(next.cols, next.rows)
  })
}

connect()
