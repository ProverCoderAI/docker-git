import { spawn } from "node-pty"

type PtyStartSpec = {
  readonly args: ReadonlyArray<string>
  readonly cols: number
  readonly command: string
  readonly cwd: string
  readonly rows: number
}

type HelperInputMessage =
  | { readonly type: "input"; readonly data: string }
  | { readonly type: "resize"; readonly cols: number; readonly rows: number }
  | { readonly type: "kill" }

type HelperOutputMessage =
  | { readonly type: "data"; readonly data: string }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "exit"; readonly exitCode: number | null; readonly signal: number | null }

const encodeMessage = (message: HelperOutputMessage): string => `${JSON.stringify(message)}\n`

const sendMessage = (message: HelperOutputMessage): void => {
  process.stdout.write(encodeMessage(message))
}

const decodeStartSpec = (): PtyStartSpec => {
  const encoded = process.argv[2]
  if (encoded === undefined) {
    throw new Error("Missing PTY start spec.")
  }
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PtyStartSpec
}

const decodeInputMessage = (line: string): HelperInputMessage | null => {
  try {
    return JSON.parse(line) as HelperInputMessage
  } catch {
    return null
  }
}

const sendData = (data: string): void => {
  sendMessage({ type: "data", data: Buffer.from(data, "utf8").toString("base64") })
}

const main = (): void => {
  const spec = decodeStartSpec()
  const pty = spawn(spec.command, [...spec.args], {
    cols: spec.cols,
    cwd: spec.cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color"
    },
    name: "xterm-256color",
    rows: spec.rows
  })

  pty.onData(sendData)
  pty.onExit(({ exitCode, signal }) => {
    sendMessage({ type: "exit", exitCode: exitCode ?? null, signal: signal ?? null })
  })

  let pending = ""
  process.stdin.setEncoding("utf8")
  process.stdin.on("data", (chunk) => {
    pending += chunk
    const lines = pending.split("\n")
    pending = lines.pop() ?? ""
    for (const line of lines) {
      const message = decodeInputMessage(line)
      if (message === null) {
        continue
      }
      if (message.type === "input") {
        pty.write(Buffer.from(message.data, "base64").toString("utf8"))
      } else if (message.type === "resize") {
        pty.resize(message.cols, message.rows)
      } else {
        pty.kill()
      }
    }
  })
}

try {
  main()
} catch (error) {
  sendMessage({ type: "error", message: String(error) })
  sendMessage({ type: "exit", exitCode: 1, signal: null })
}
