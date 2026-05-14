import { Effect, Either } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ApiTerminalSession } from "../../src/docker-git/api-terminal-codec.js"
import type { TerminalSessionClientError } from "../../src/docker-git/terminal-session-client.js"

const resolveApiBaseUrlMock = vi.hoisted(() => vi.fn<() => string>())
const writeToTerminalMock = vi.hoisted(() => vi.fn<(text: string) => void>())

vi.mock("../../src/docker-git/controller.js", () => ({
  resolveApiBaseUrl: resolveApiBaseUrlMock
}))

vi.mock("../../src/docker-git/terminal-output.js", () => ({
  writeToTerminal: writeToTerminalMock
}))

type FakeSocketListener =
  | { readonly listener: () => void; readonly type: "close" }
  | { readonly listener: () => void; readonly type: "error" }
  | { readonly listener: () => void; readonly type: "open" }
  | { readonly listener: (event: { readonly data: string }) => void; readonly type: "message" }

type SocketListenerType = "close" | "error" | "message" | "open"

const isMessageSocketListener = (
  type: SocketListenerType,
  _listener: (() => void) | ((event: { readonly data: string }) => void)
): _listener is (event: { readonly data: string }) => void => type === "message"

const isVoidSocketListener = (
  type: SocketListenerType,
  _listener: (() => void) | ((event: { readonly data: string }) => void)
): _listener is () => void => type !== "message"

type StdinListener = Parameters<typeof process.stdin.on>[1]
type StdoutListener = Parameters<typeof process.stdout.on>[1]

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static readonly instances: Array<FakeWebSocket> = []

  readonly sent: Array<string> = []
  readonly url: string
  readyState = FakeWebSocket.CONNECTING
  private readonly listeners: Array<FakeSocketListener> = []

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: "message", listener: (event: { readonly data: string }) => void): void
  addEventListener(type: "close" | "error" | "open", listener: () => void): void
  addEventListener(
    type: SocketListenerType,
    listener: (() => void) | ((event: { readonly data: string }) => void)
  ): void {
    if (type === "message" && isMessageSocketListener(type, listener)) {
      this.listeners.push({ listener, type: "message" })
      return
    }
    if (isVoidSocketListener(type, listener)) {
      if (type === "close") {
        this.listeners.push({ listener, type: "close" })
      }
      if (type === "error") {
        this.listeners.push({ listener, type: "error" })
      }
      if (type === "open") {
        this.listeners.push({ listener, type: "open" })
      }
    }
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return
    }
    this.readyState = FakeWebSocket.CLOSED
    for (const entry of this.listeners) {
      if (entry.type === "close") {
        entry.listener()
      }
    }
  }

  send(data: string): void {
    this.sent.push(data)
  }

  emitMessage(data: string): void {
    for (const entry of this.listeners) {
      if (entry.type === "message") {
        entry.listener({ data })
      }
    }
  }

  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN
    for (const entry of this.listeners) {
      if (entry.type === "open") {
        entry.listener()
      }
    }
  }
}

const loadTerminalSessionClient = Effect.tryPromise({
  try: () => import("../../src/docker-git/terminal-session-client.js"),
  catch: (error) => (error instanceof Error ? error : new Error(String(error)))
})

const originalStdinIsTty = process.stdin.isTTY
const originalStdoutIsTty = process.stdout.isTTY
const originalStdoutColumns = process.stdout.columns
const originalStdoutRows = process.stdout.rows
const originalStdinOff = process.stdin.off.bind(process.stdin)
const originalStdinOn = process.stdin.on.bind(process.stdin)
const originalStdoutOff = process.stdout.off.bind(process.stdout)
const originalStdoutOn = process.stdout.on.bind(process.stdout)
const originalStdinResume = process.stdin.resume.bind(process.stdin)
const originalSetRawMode = typeof process.stdin.setRawMode === "function"
  ? process.stdin.setRawMode.bind(process.stdin)
  : undefined

const setRawModeMock = vi.fn((_enabled: boolean) => process.stdin)
const stdinOnMock = vi.fn((_event: string, _listener: StdinListener) => process.stdin)
const stdinOffMock = vi.fn((_event: string, _listener: StdinListener) => process.stdin)
const stdoutOnMock = vi.fn((_event: string, _listener: StdoutListener) => process.stdout)
const stdoutOffMock = vi.fn((_event: string, _listener: StdoutListener) => process.stdout)
const stdinResumeMock = vi.fn(() => process.stdin)

const makeSession = (): ApiTerminalSession => ({
  createdAt: "2026-04-20T10:00:00Z",
  id: "session-1",
  projectId: "/controller/provercoderai/docker-git/main",
  sshCommand: "ssh -p 22 dev@172.17.0.6",
  status: "ready"
})

const makeAttachment = () => ({
  header: "SSH terminal: provercoderai/docker-git (main)",
  session: makeSession(),
  websocketPath: "/projects/%2Fcontroller%2Fprovercoderai%2Fdocker-git%2Fmain/terminal-sessions/session-1/ws"
})

const firstSocket = (): FakeWebSocket => {
  const socket = FakeWebSocket.instances[0]
  if (socket === undefined) {
    expect.fail("Expected a websocket instance.")
  }
  return socket
}

const startAttachment = (
  attachTerminalSession: (
    attachment: ReturnType<typeof makeAttachment>
  ) => Effect.Effect<void, TerminalSessionClientError>
) => {
  const promise = Effect.runPromise(attachTerminalSession(makeAttachment()).pipe(Effect.either))
  return { promise, socket: firstSocket() }
}

const startOpenedAttachment = (
  attachTerminalSession: (
    attachment: ReturnType<typeof makeAttachment>
  ) => Effect.Effect<void, TerminalSessionClientError>
) => {
  const started = startAttachment(attachTerminalSession)
  started.socket.emitOpen()
  return started
}

const expectSocketCleanup = (
  socket: FakeWebSocket,
  writes: ReadonlyArray<ReadonlyArray<string>>
): void => {
  expect(writeToTerminalMock.mock.calls).toEqual(writes)
  expect(setRawModeMock).toHaveBeenNthCalledWith(1, true)
  expect(setRawModeMock).toHaveBeenLastCalledWith(false)
  expect(socket.sent).toEqual([
    JSON.stringify({ type: "resize", cols: 132, rows: 40 }),
    JSON.stringify({ type: "close" })
  ])
}

describe("terminal-session-client", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    resolveApiBaseUrlMock.mockReset()
    resolveApiBaseUrlMock.mockReturnValue("http://controller.example/api")
    writeToTerminalMock.mockReset()
    setRawModeMock.mockClear()
    stdinOnMock.mockClear()
    stdinOffMock.mockClear()
    stdoutOnMock.mockClear()
    stdoutOffMock.mockClear()
    stdinResumeMock.mockClear()
    FakeWebSocket.instances.length = 0

    vi.stubGlobal("WebSocket", FakeWebSocket)
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true })
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true })
    Object.defineProperty(process.stdout, "columns", { configurable: true, value: 132 })
    Object.defineProperty(process.stdout, "rows", { configurable: true, value: 40 })
    Object.defineProperty(process.stdin, "setRawMode", { configurable: true, value: setRawModeMock })
    Object.defineProperty(process.stdin, "on", { configurable: true, value: stdinOnMock })
    Object.defineProperty(process.stdin, "off", { configurable: true, value: stdinOffMock })
    Object.defineProperty(process.stdout, "on", { configurable: true, value: stdoutOnMock })
    Object.defineProperty(process.stdout, "off", { configurable: true, value: stdoutOffMock })
    Object.defineProperty(process.stdin, "resume", { configurable: true, value: stdinResumeMock })
  })

  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(process.stdin, "setRawMode", { configurable: true, value: originalSetRawMode })
    Object.defineProperty(process.stdin, "on", { configurable: true, value: originalStdinOn })
    Object.defineProperty(process.stdin, "off", { configurable: true, value: originalStdinOff })
    Object.defineProperty(process.stdout, "on", { configurable: true, value: originalStdoutOn })
    Object.defineProperty(process.stdout, "off", { configurable: true, value: originalStdoutOff })
    Object.defineProperty(process.stdin, "resume", { configurable: true, value: originalStdinResume })
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: originalStdinIsTty })
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: originalStdoutIsTty })
    Object.defineProperty(process.stdout, "columns", { configurable: true, value: originalStdoutColumns })
    Object.defineProperty(process.stdout, "rows", { configurable: true, value: originalStdoutRows })
    vi.unstubAllGlobals()
  })

  it("fails fast when the websocket never opens", () =>
    Effect.gen(function*(_) {
      const { attachTerminalSession } = yield* _(loadTerminalSessionClient)
      const result = yield* _(Effect.promise(() => {
        const promise = Effect.runPromise(attachTerminalSession(makeAttachment()).pipe(Effect.either))
        return vi.advanceTimersByTimeAsync(3001).then(() => promise)
      }))

      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left.message).toBe("Terminal websocket open timed out.")
      }

      const socket = firstSocket()
      expect(socket.url).toBe(
        "ws://controller.example/api/projects/%2Fcontroller%2Fprovercoderai%2Fdocker-git%2Fmain/terminal-sessions/session-1/ws?cols=132&rows=40"
      )
      expect(socket.sent).toEqual([])
      expect(setRawModeMock).toHaveBeenCalledWith(false)
      expect(setRawModeMock).not.toHaveBeenCalledWith(true)
    }).pipe(Effect.runPromise))

  it("fails when the socket opens but no server message arrives", () =>
    Effect.gen(function*(_) {
      const { attachTerminalSession } = yield* _(loadTerminalSessionClient)
      const { promise, socket } = startOpenedAttachment(attachTerminalSession)

      const result = yield* _(Effect.promise(() => vi.advanceTimersByTimeAsync(5001).then(() => promise)))

      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left.message).toBe("Terminal session attach timed out.")
      }

      expectSocketCleanup(socket, [
        ["\n[docker-git] SSH terminal: provercoderai/docker-git (main)\n"],
        ["[docker-git] ssh -p 22 dev@172.17.0.6\n\n"]
      ])
    }).pipe(Effect.runPromise))

  it("streams terminal output and exits cleanly after attach", () =>
    Effect.gen(function*(_) {
      const { attachTerminalSession } = yield* _(loadTerminalSessionClient)
      const { promise, socket } = startOpenedAttachment(attachTerminalSession)
      socket.emitMessage(JSON.stringify({
        session: {
          ...makeSession(),
          status: "attached"
        },
        type: "ready"
      }))
      socket.emitMessage(JSON.stringify({ data: "dev@container:~$ ", type: "output" }))
      socket.emitMessage(JSON.stringify({ exitCode: 0, signal: null, type: "exit" }))

      const result = yield* _(Effect.promise(() => promise))

      expect(Either.isRight(result)).toBe(true)
      expectSocketCleanup(socket, [
        ["\n[docker-git] SSH terminal: provercoderai/docker-git (main)\n"],
        ["[docker-git] ssh -p 22 dev@172.17.0.6\n\n"],
        ["dev@container:~$ "],
        ["\n[docker-git] terminal finished (exit 0)\n"]
      ])
    }).pipe(Effect.runPromise))
})
