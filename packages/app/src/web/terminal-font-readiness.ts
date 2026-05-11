import { Effect } from "effect"

type FontLoadResult = ReadonlyArray<object>

export type FontReadinessTarget = {
  readonly load: (descriptor: string) => PromiseLike<FontLoadResult>
  readonly ready: PromiseLike<object>
}

export type DelayScheduler = {
  readonly schedule: (callback: () => void, delayMs: number) => () => void
}

export type TerminalFontReadinessArgs = {
  readonly descriptors: ReadonlyArray<string>
  readonly fonts: FontReadinessTarget | undefined
  readonly scheduler?: DelayScheduler
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

const delayedFallback = (
  timeoutMs: number,
  scheduler: DelayScheduler
): Effect.Effect<void> =>
  Effect.async((resume: (effect: Effect.Effect<void>) => void) => {
    const cancel = scheduler.schedule(() => {
      resume(Effect.void)
    }, timeoutMs)
    return Effect.sync(() => {
      cancel()
    })
  })

const defaultScheduler: DelayScheduler = {
  schedule: (callback, delayMs) => {
    const handle = globalThis.setTimeout(callback, delayMs)
    return () => {
      globalThis.clearTimeout(handle)
    }
  }
}

const resolveScheduler = (args: TerminalFontReadinessArgs): DelayScheduler => args.scheduler ?? defaultScheduler

const fontReadinessEffect = (
  fonts: FontReadinessTarget,
  args: TerminalFontReadinessArgs
): Effect.Effect<void> => {
  const timeoutMs = args.timeoutMs ?? defaultTimeoutMs
  const work = ensureFontsLoaded(fonts, args.descriptors)
  if (timeoutMs <= 0) {
    return work
  }
  return Effect.race(work, delayedFallback(timeoutMs, resolveScheduler(args)))
}

export const awaitTerminalFontReadiness = (
  args: TerminalFontReadinessArgs
): Effect.Effect<void> => {
  if (args.fonts === undefined) {
    return Effect.void
  }
  return fontReadinessEffect(args.fonts, args)
}

type GlobalThisWithDocument = {
  readonly document?: { readonly fonts: FontReadinessTarget }
}

export const resolveDocumentFontFaceSet = (): FontReadinessTarget | undefined => {
  const globals: GlobalThisWithDocument = globalThis
  return globals.document?.fonts
}
