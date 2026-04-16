export const terminalReconnectGraceMs = 60_000

const reconnectBaseDelayMs = 500
const reconnectMaxDelayMs = 3000

export const resolveTerminalReconnectDelay = (attempt: number): number =>
  Math.min(reconnectBaseDelayMs * (2 ** Math.max(0, attempt)), reconnectMaxDelayMs)
