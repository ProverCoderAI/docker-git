import { WebSocket } from "ws"

const defaultHeartbeatIntervalMs = 25_000

export const attachWebSocketHeartbeat = (
  socket: WebSocket,
  intervalMs = defaultHeartbeatIntervalMs
): void => {
  let alive = true
  const interval = setInterval(() => {
    if (socket.readyState !== WebSocket.OPEN) {
      return
    }
    if (!alive) {
      socket.terminate()
      return
    }
    alive = false
    socket.ping()
  }, intervalMs)

  socket.on("pong", () => {
    alive = true
  })
  socket.on("close", () => {
    clearInterval(interval)
  })
  socket.on("error", () => {
    clearInterval(interval)
  })
}
