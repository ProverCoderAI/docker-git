import { Effect } from "effect"

type FontLoadResult = ReadonlyArray<object>

export type FontReadinessTarget = {
  readonly load: (descriptor: string) => PromiseLike<FontLoadResult>
  readonly ready: PromiseLike<object>
}

export type TerminalFontReadinessArgs = {
  readonly clearTimeoutImpl?: typeof globalThis.clearTimeout
  readonly descriptors: ReadonlyArray<string>
  readonly fonts: FontReadinessTarget | undefined
  readonly setTimeoutImpl?: typeof globalThis.setTimeout
  readonly timeoutMs?: number
}

const defaultTimeoutMs = 2000

const awaitSettled = <A>(thenable: PromiseLike<A>): Effect.Effect<void> =>
  Effect.async((resume: (effect: Effect.Effect<void>) => void) => {
    thenable.then(
      () => {
        resume(Effect.void)
      },
      () => {
        resume(Effect.void)
      }
    )
  })

const loadDescriptor = (
  fonts: FontReadinessTarget,
  descriptor: string
): Effect.Effect<void> => awaitSettled(fonts.load(descriptor))

const awaitFontsReady = (fonts: FontReadinessTarget): Effect.Effect<void> => awaitSettled(fonts.ready)

const ensureFontsLoaded = (
  fonts: FontReadinessTarget,
  descriptors: ReadonlyArray<string>
): Effect.Effect<void> =>
  Effect.all(
    [awaitFontsReady(fonts), ...descriptors.map((descriptor) => loadDescriptor(fonts, descriptor))],
    { concurrency: "unbounded" }
  ).pipe(Effect.asVoid)

type DelayTimers = {
  readonly clearTimeoutImpl: typeof globalThis.clearTimeout
  readonly setTimeoutImpl: typeof globalThis.setTimeout
}

const delayedFallback = (
  timeoutMs: number,
  timers: DelayTimers
): Effect.Effect<void> =>
  Effect.async((resume: (effect: Effect.Effect<void>) => void) => {
    const handle = timers.setTimeoutImpl(() => {
      resume(Effect.void)
    }, timeoutMs)
    return Effect.sync(() => {
      timers.clearTimeoutImpl(handle)
    })
  })

const resolveTimers = (args: TerminalFontReadinessArgs): DelayTimers => ({
  clearTimeoutImpl: args.clearTimeoutImpl ?? globalThis.clearTimeout,
  setTimeoutImpl: args.setTimeoutImpl ?? globalThis.setTimeout
})

const fontReadinessEffect = (
  fonts: FontReadinessTarget,
  args: TerminalFontReadinessArgs
): Effect.Effect<void> => {
  const timeoutMs = args.timeoutMs ?? defaultTimeoutMs
  const work = ensureFontsLoaded(fonts, args.descriptors)
  if (timeoutMs <= 0) {
    return work
  }
  return Effect.race(work, delayedFallback(timeoutMs, resolveTimers(args)))
}

export const awaitTerminalFontReadiness = (
  args: TerminalFontReadinessArgs
): Effect.Effect<void> => {
  if (args.fonts === undefined) {
    return Effect.void
  }
  return fontReadinessEffect(args.fonts, args)
}

export const resolveDocumentFontFaceSet = (): FontReadinessTarget | undefined => {
  const documentRef = (globalThis as { readonly document?: { readonly fonts?: FontReadinessTarget } }).document
  return documentRef?.fonts
}
