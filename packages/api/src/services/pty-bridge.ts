import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

export type PtyExit = {
  readonly exitCode: number | null
  readonly signal: number | null
}

export type PtyBridge = {
  readonly kill: () => void
  readonly onData: (handler: (data: string) => void) => void
  readonly onExit: (handler: (exit: PtyExit) => void) => void
  readonly resize: (cols: number, rows: number) => void
  readonly write: (data: string) => void
}

type PtyBridgeSpec = {
  readonly args: ReadonlyArray<string>
  readonly cols: number
  readonly command: string
  readonly cwd: string
  readonly rows: number
}

type HelperOutputMessage =
  | { readonly type: "data"; readonly data: string }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "exit"; readonly exitCode: number | null; readonly signal: number | null }

const helperPath = fileURLToPath(new URL("./pty-helper.js", import.meta.url))
const nodeCommand = process.env["DOCKER_GIT_NODE_BINARY"]?.trim() || "node"

const encodeStartSpec = (spec: PtyBridgeSpec): string =>
  Buffer.from(JSON.stringify(spec), "utf8").toString("base64url")

const encodeInput = (data: string): string => Buffer.from(data, "utf8").toString("base64")

const encodeCommand = (message: object): string => `${JSON.stringify(message)}\n`

const decodeOutputMessage = (line: string): HelperOutputMessage | null => {
  try {
    return JSON.parse(line) as HelperOutputMessage
  } catch {
    return null
  }
}

const decodeOutputData = (data: string): string => Buffer.from(data, "base64").toString("utf8")

export const spawnPtyBridge = (spec: PtyBridgeSpec): PtyBridge => {
  const child = spawn(nodeCommand, [helperPath, encodeStartSpec(spec)], {
    cwd: spec.cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color"
    },
    stdio: ["pipe", "pipe", "pipe"]
  })
  const dataHandlers = new Set<(data: string) => void>()
  const exitHandlers = new Set<(exit: PtyExit) => void>()
  let exitSeen = false
  let pending = ""

  const emitData = (data: string): void => {
    for (const handler of dataHandlers) {
      handler(data)
    }
  }
  const emitExit = (exit: PtyExit): void => {
    if (exitSeen) {
      return
    }
    exitSeen = true
    for (const handler of exitHandlers) {
      handler(exit)
    }
  }
  const sendCommand = (message: object): void => {
    if (!child.stdin.destroyed) {
      child.stdin.write(encodeCommand(message))
    }
  }

  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk) => {
    pending += chunk
    const lines = pending.split("\n")
    pending = lines.pop() ?? ""
    for (const line of lines) {
      const message = decodeOutputMessage(line)
      if (message === null) {
        continue
      }
      if (message.type === "data") {
        emitData(decodeOutputData(message.data))
      } else if (message.type === "error") {
        emitData(`\r\n[pty helper error] ${message.message}\r\n`)
      } else {
        emitExit({ exitCode: message.exitCode, signal: message.signal })
      }
    }
  })
  child.stderr.on("data", (chunk) => {
    emitData(`\r\n[pty helper stderr] ${String(chunk)}\r\n`)
  })
  child.on("exit", (exitCode) => {
    emitExit({ exitCode, signal: null })
  })

  return {
    kill: () => {
      sendCommand({ type: "kill" })
      child.kill()
    },
    onData: (handler) => {
      dataHandlers.add(handler)
    },
    onExit: (handler) => {
      exitHandlers.add(handler)
    },
    resize: (cols, rows) => {
      sendCommand({ type: "resize", cols, rows })
    },
    write: (data) => {
      sendCommand({ type: "input", data: encodeInput(data) })
    }
  }
}
