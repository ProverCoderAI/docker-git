import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { afterEach, beforeEach, vi } from "vitest"

const repairInteractiveTerminalMock = vi.hoisted(() => vi.fn<(fallbackWrite?: (chunk: string) => void) => void>())

vi.mock("../../src/lib/usecases/terminal-cursor.js", () => ({
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

const originalStdoutWrite: typeof process.stdout.write = process.stdout.write.bind(process.stdout)
const originalStderrWrite: typeof process.stderr.write = process.stderr.write.bind(process.stderr)
const originalStdinTty = process.stdin.isTTY
const originalStdoutTty = process.stdout.isTTY
const originalSetRawMode: typeof process.stdin.setRawMode =
  ((_enabled: boolean) => process.stdin) as typeof process.stdin.setRawMode

const loadMenuShared = Effect.tryPromise({
  try: () => import("../../src/docker-git/menu-shared.js"),
  catch: (error) => (error instanceof Error ? error : new Error(String(error)))
})

const restoreTerminalBindings = (): void => {
  process.stdout.write = originalStdoutWrite
  process.stderr.write = originalStderrWrite
  process.stdin.setRawMode = originalSetRawMode
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: originalStdinTty })
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: originalStdoutTty })
}

const createRawModeStub = (events: Array<string>): typeof process.stdin.setRawMode =>
  ((enabled: boolean) => {
    events.push(`raw:${String(enabled)}`)
    return process.stdin
  }) as typeof process.stdin.setRawMode

const createWriteStub = (
  events: Array<string>
): typeof process.stdout.write =>
  ((
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void
  ) => {
    events.push(`write:${String(chunk)}`)
    const callback = typeof encoding === "function" ? encoding : cb
    callback?.()
    return true
  }) as typeof process.stdout.write

const installPatchedTerminal = (events: Array<string>): void => {
  process.stdin.setRawMode = createRawModeStub(events)
  process.stdout.write = createWriteStub(events)
  process.stderr.write = (() => true) as typeof process.stderr.write
}

const installRepairRecorder = (events: Array<string>): void => {
  repairInteractiveTerminalMock.mockImplementation((fallbackWrite) => {
    events.push("repair")
    fallbackWrite?.("<repair>")
  })
}

const createMenuSharedFixture = () =>
  Effect.gen(function*(_) {
    const events: Array<string> = []
    installPatchedTerminal(events)
    installRepairRecorder(events)
    const menuShared = yield* _(loadMenuShared)
    return { events, menuShared } as const
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

      suspendTui()
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

      suspendTui()
      events.length = 0
      repairInteractiveTerminalMock.mockClear()
      installRepairRecorder(events)

      resumeTui()
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
        )
      )

      expect(events).toEqual([
        "repair",
        "write:<repair>",
        `write:${primaryScreenEscape}`,
        "effect",
        "write:ssh output",
        "repair",
        "write:<repair>",
        `write:${alternateScreenEscape}`,
        "raw:true",
        `write:${inputModesEscape}`,
        "resume"
      ])
    }))

  it.effect("restores the primary screen on exit with a clean current line", () =>
    Effect.gen(function*(_) {
      const {
        events,
        menuShared: { leaveTui }
      } = yield* _(createMenuSharedFixture())

      leaveTui()

      expect(events).toEqual([
        "repair",
        "write:<repair>",
        `write:${primaryScreenEscape}`,
        "raw:false"
      ])
    }))
})
