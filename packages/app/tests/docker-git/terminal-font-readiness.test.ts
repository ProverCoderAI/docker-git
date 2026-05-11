import { describe, expect, it } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber } from "effect"

import { awaitTerminalFontReadiness } from "../../src/web/terminal-font-readiness.js"

type DeferredHandle<A> = {
  readonly deferred: Deferred.Deferred<A, Error>
  readonly thenable: PromiseLike<A>
}

const makeDeferredHandle = <A>(): Effect.Effect<DeferredHandle<A>> =>
  Effect.gen(function*(_) {
    const deferred = yield* _(Deferred.make<A, Error>())
    const thenable = Effect.runPromise(Deferred.await(deferred))
    return { deferred, thenable }
  })

type FontFaceSetMock = {
  readonly load: (descriptor: string) => PromiseLike<ReadonlyArray<object>>
  readonly loadCalls: ReadonlyArray<string>
  readonly ready: PromiseLike<object>
  readonly rejectLoads: () => Effect.Effect<void>
  readonly rejectReady: () => Effect.Effect<void>
  readonly resolveLoads: () => Effect.Effect<void>
  readonly resolveReady: () => Effect.Effect<void>
}

const createFontsMock = (
  readyHandle: DeferredHandle<object>,
  loadHandleFactory: () => Effect.Effect<DeferredHandle<ReadonlyArray<object>>>
): FontFaceSetMock => {
  const loadCalls: Array<string> = []
  const loadHandles: Array<DeferredHandle<ReadonlyArray<object>>> = []
  return {
    get loadCalls(): ReadonlyArray<string> {
      return loadCalls
    },
    load: (descriptor: string) => {
      loadCalls.push(descriptor)
      const handle = Effect.runSync(loadHandleFactory())
      loadHandles.push(handle)
      return handle.thenable
    },
    ready: readyHandle.thenable,
    rejectLoads: () =>
      Effect.gen(function*(_) {
        for (const handle of loadHandles) {
          yield* _(Deferred.fail(handle.deferred, new Error("font load failed")))
        }
      }),
    rejectReady: () => Deferred.fail(readyHandle.deferred, new Error("fonts ready failed")).pipe(Effect.asVoid),
    resolveLoads: () =>
      Effect.gen(function*(_) {
        for (const handle of loadHandles) {
          yield* _(Deferred.succeed(handle.deferred, [] as ReadonlyArray<object>))
        }
      }),
    resolveReady: () => Deferred.succeed(readyHandle.deferred, {}).pipe(Effect.asVoid)
  }
}

const makeFontsMock = (): Effect.Effect<FontFaceSetMock> =>
  Effect.gen(function*(_) {
    const readyHandle = yield* _(makeDeferredHandle<object>())
    return createFontsMock(readyHandle, () => makeDeferredHandle<ReadonlyArray<object>>())
  })

type TimersMock = {
  readonly cleared: ReadonlyArray<object>
  readonly clearTimeoutImpl: typeof globalThis.clearTimeout
  readonly fire: () => void
  readonly setTimeoutImpl: typeof globalThis.setTimeout
}

const createTimers = (): TimersMock => {
  const handlers: Array<{ readonly callback: () => void; readonly id: object }> = []
  const cleared: Array<object> = []
  return {
    cleared,
    clearTimeoutImpl: ((id: object) => {
      cleared.push(id)
      const index = handlers.findIndex((handler) => handler.id === id)
      if (index !== -1) {
        handlers.splice(index, 1)
      }
    }) as typeof globalThis.clearTimeout,
    fire: () => {
      const next = handlers.shift()
      next?.callback()
    },
    setTimeoutImpl: ((callback: () => void) => {
      const id = {}
      handlers.push({ callback, id })
      return id as ReturnType<typeof globalThis.setTimeout>
    }) as typeof globalThis.setTimeout
  }
}

const yieldThrice = Effect.gen(function*(_) {
  yield* _(Effect.yieldNow())
  yield* _(Effect.yieldNow())
  yield* _(Effect.yieldNow())
})

type FontReadinessFixture = {
  readonly fiber: Fiber.RuntimeFiber<void>
  readonly fonts: FontFaceSetMock
  readonly timers: TimersMock
}

const startFontReadinessFixture = (
  descriptors: ReadonlyArray<string>,
  timeoutMs?: number
): Effect.Effect<FontReadinessFixture> =>
  Effect.gen(function*(_) {
    const fonts = yield* _(makeFontsMock())
    const timers = createTimers()
    const baseArgs = {
      clearTimeoutImpl: timers.clearTimeoutImpl,
      descriptors,
      fonts,
      setTimeoutImpl: timers.setTimeoutImpl
    }
    const args = timeoutMs === undefined ? baseArgs : { ...baseArgs, timeoutMs }
    const fiber = yield* _(Effect.fork(awaitTerminalFontReadiness(args)))
    yield* _(yieldThrice)
    return { fiber, fonts, timers }
  })

describe("terminal font readiness", () => {
  it.effect("resolves immediately when no FontFaceSet is provided", () =>
    Effect.gen(function*(_) {
      const result = yield* _(
        awaitTerminalFontReadiness({ descriptors: ["14px 'Test'"], fonts: undefined })
      )
      expect(result).toBeUndefined()
    }))

  it.effect("resolves once the ready promise and every load promise settle", () =>
    Effect.gen(function*(_) {
      const descriptors = ["14px 'IBM Plex Mono'", "bold 14px 'IBM Plex Mono'"]
      const { fiber, fonts, timers } = yield* _(startFontReadinessFixture(descriptors))
      expect(fonts.loadCalls).toEqual(descriptors)
      yield* _(fonts.resolveReady())
      yield* _(fonts.resolveLoads())
      yield* _(Fiber.join(fiber))
      expect(timers.cleared.length).toBe(1)
    }))

  it.effect("swallows load failures so callers still proceed", () =>
    Effect.gen(function*(_) {
      const { fiber, fonts } = yield* _(startFontReadinessFixture(["14px 'IBM Plex Mono'"]))
      yield* _(fonts.rejectReady())
      yield* _(fonts.rejectLoads())
      const exit = yield* _(Fiber.await(fiber))
      expect(Exit.isSuccess(exit)).toBe(true)
    }))

  it.effect("falls back to the timeout when fonts never settle", () =>
    Effect.gen(function*(_) {
      const { fiber, timers } = yield* _(startFontReadinessFixture(["14px 'IBM Plex Mono'"], 1000))
      timers.fire()
      const result = yield* _(Fiber.join(fiber))
      expect(result).toBeUndefined()
    }))
})
