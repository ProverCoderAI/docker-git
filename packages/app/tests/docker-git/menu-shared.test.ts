import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { afterEach, beforeEach, vi } from "vitest"

const repairInteractiveTerminalMock = vi.hoisted(() =>
  vi.fn<(fallbackWrite?: (chunk: string) => void) => Effect.Effect<void>>()
)

vi.mock("../../src/docker-git/frontend-lib/shell/terminal-cursor.js", () => ({
  repairInteractiveTerminal: repairInteractiveTerminalMock
}))

const primaryScreenEscape = "\u001B[?1049l\r\u001B[2K"
const alternateScreenEscape = "\u001B[?1049h\u001B[2J\u001B[H"
const inputModesEscape = "\u001B[0m" +
  "\u001B[?25h" +
  "\u001B[?1l" +
  "\u001B>" +
  "\u001B[?1000l\u001B[?1002l\u001B[?1003l\u001B[?1005l\u001B[?1006l\u001B[?1015l\u001B[?1007l" +
  "\u001B[?1004l\u001B[?2004l" +
  "\u001B[>4;0m\u001B[>4m\u001B[<u"
const primaryScreenRepairEvents = ["repair", "write:<repair>", `write:${primaryScreenEscape}`]
const alternateScreenResumeEvents = [
  "repair",
  "write:<repair>",
  `write:${alternateScreenEscape}`,
  "raw:true",
  `write:${inputModesEscape}`
]

const originalStdoutWrite: typeof process.stdout.write = process.stdout.write.bind(process.stdout)
const originalStderrWrite: typeof process.stderr.write = process.stderr.write.bind(process.stderr)
const originalStdinTty = process.stdin.isTTY
const originalStdoutTty = process.stdout.isTTY
const originalSetRawMode = Reflect.get(process.stdin, "setRawMode")

const loadMenuShared = Effect.tryPromise({
  try: () => import("../../src/docker-git/menu-shared.js"),
  catch: (error) => (error instanceof Error ? error : new Error(String(error)))
})

const restoreTerminalBindings = (): void => {
  process.stdout.write = originalStdoutWrite
  process.stderr.write = originalStderrWrite
  Object.defineProperty(process.stdin, "setRawMode", { configurable: true, value: originalSetRawMode })
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: originalStdinTty })
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: originalStdoutTty })
}

const createRawModeStub = (events: Array<string>): typeof process.stdin.setRawMode => (enabled: boolean) => {
  events.push(`raw:${String(enabled)}`)
  return process.stdin
}

const createWriteStub = (
  events: Array<string>
): typeof process.stdout.write =>
  function writeStub(
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void
  ) {
    events.push(`write:${String(chunk)}`)
    const callback = typeof encoding === "function" ? encoding : cb
    callback?.()
    return true
  }

const installPatchedTerminal = (events: Array<string>): void => {
  process.stdin.setRawMode = createRawModeStub(events)
  process.stdout.write = createWriteStub(events)
  process.stderr.write = createWriteStub(events)
}

const installRepairRecorder = (events: Array<string>): void => {
  repairInteractiveTerminalMock.mockImplementation((fallbackWrite) =>
    Effect.sync(() => {
      events.push("repair")
      fallbackWrite?.("<repair>")
    })
  )
}

const createMenuSharedFixture = () =>
  Effect.gen(function*(_) {
    const events: Array<string> = []
    installPatchedTerminal(events)
    installRepairRecorder(events)
    const menuShared = yield* _(loadMenuShared)
    return { events, menuShared }
  })

describe("menu-shared terminal boundary", () => {
  beforeEach(() => {
    vi.resetModules()
    repairInteractiveTerminalMock.mockReset()
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true })
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true })
  })

  afterEach(() => {
    restoreTerminalBindings()
  })

  it.effect("mutes TUI writes before handing the terminal to SSH", () =>
    Effect.gen(function*(_) {
      const {
        events,
        menuShared: { suspendTui, writeToTerminal }
      } = yield* _(createMenuSharedFixture())

      yield* _(suspendTui().pipe(Effect.provide(NodeContext.layer)))
      process.stdout.write("hidden gridland frame")
      writeToTerminal("visible ssh header")

      expect(events).toEqual([
        "repair",
        "write:<repair>",
        `write:${primaryScreenEscape}`,
        "write:visible ssh header"
      ])
      expect(events).not.toContain("raw:false")
    }))

  it.effect("restores the alternate screen before unmuting TUI writes", () =>
    Effect.gen(function*(_) {
      const {
        events,
        menuShared: { resumeTui, suspendTui }
      } = yield* _(createMenuSharedFixture())

      yield* _(suspendTui().pipe(Effect.provide(NodeContext.layer)))
      events.length = 0
      repairInteractiveTerminalMock.mockClear()
      installRepairRecorder(events)

      yield* _(resumeTui().pipe(Effect.provide(NodeContext.layer)))
      process.stdout.write("restored gridland frame")

      expect(events).toEqual([
        "repair",
        "write:<repair>",
        `write:${alternateScreenEscape}`,
        "raw:true",
        `write:${inputModesEscape}`,
        "write:restored gridland frame"
      ])
    }))

  it.effect("runs the wrapped effect between suspend and resume", () =>
    Effect.gen(function*(_) {
      const {
        events,
        menuShared: { withSuspendedTui, writeToTerminal }
      } = yield* _(createMenuSharedFixture())

      yield* _(
        withSuspendedTui(
          Effect.sync(() => {
            events.push("effect")
            writeToTerminal("ssh output")
          }),
          {
            onResume: () => {
              events.push("resume")
            }
          }
        ).pipe(Effect.provide(NodeContext.layer))
      )

      expect(events).toEqual([
        ...primaryScreenRepairEvents,
        "effect",
        "write:ssh output",
        ...alternateScreenResumeEvents,
        "resume"
      ])
    }))

  it.effect("restores the primary screen on exit with a clean current line", () =>
    Effect.gen(function*(_) {
      const {
        events,
        menuShared: { leaveTui }
      } = yield* _(createMenuSharedFixture())

      yield* _(leaveTui().pipe(Effect.provide(NodeContext.layer)))

      expect(events).toEqual([...primaryScreenRepairEvents, "raw:false"])
    }))
})
