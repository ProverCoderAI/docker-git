import { FetchHttpClient, HttpClient, HttpClientResponse } from "@effect/platform"
import { Duration, Effect } from "effect"
import * as Stream from "effect/Stream"

import { resolveTerminalImageFetchUrl } from "./terminal-image-url.js"
import {
  splitTerminalInlineImageOutput,
  type TerminalInlineImageOutputSegment,
  writeTerminalOutputSegment
} from "./terminal-inline-images-core.js"
import {
  appendTerminalInlineImagePreview,
  cachedTerminalInlineImageEntry,
  cacheTerminalInlineImageBlob,
  terminalInlineImageSpacer,
  unavailableTerminalInlineImageEntry
} from "./terminal-inline-images.js"
import type { TerminalInlineImageEntry } from "./terminal-inline-images.js"
import type { TerminalMessageHandlers } from "./terminal-panel-runtime-types.js"

type TerminalInlineImageFetchError = {
  readonly _tag: "TerminalInlineImageFetchError"
  readonly message: string
}

type TerminalInlineImageBufferState = {
  readonly chunks: ReadonlyArray<Uint8Array>
  readonly size: number
}

const terminalInlineImageFetchTimeout = Duration.seconds(10)
const terminalInlineImageMaxBytes = 10 * 1024 * 1024

const emptyTerminalInlineImageBufferState: TerminalInlineImageBufferState = {
  chunks: [],
  size: 0
}

const terminalImageEntry = (
  handlers: TerminalMessageHandlers,
  path: string
): TerminalInlineImageEntry | null => {
  const fetchUrl = resolveTerminalImageFetchUrl(handlers.session.websocketPath, path)
  return cachedTerminalInlineImageEntry(handlers.lifecycle.inlineImageObjectUrls, path, fetchUrl)
}

const terminalInlineImageFetchError = (message: string): TerminalInlineImageFetchError => ({
  _tag: "TerminalInlineImageFetchError",
  message
})

const terminalInlineImageFetchHeaders: Readonly<Record<string, string>> = {
  accept: "image/*",
  "cache-control": "no-cache, no-store, max-age=0",
  pragma: "no-cache"
}

const readContentLength = (headers: Readonly<Record<string, string | undefined>>): number | null => {
  const value = headers["content-length"]
  if (value === undefined) {
    return null
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

const validateTerminalInlineImageSize = (size: number): Effect.Effect<void, TerminalInlineImageFetchError> =>
  size > terminalInlineImageMaxBytes
    ? Effect.fail(terminalInlineImageFetchError("Terminal image is too large."))
    : Effect.void

const appendTerminalInlineImageChunk = (
  state: TerminalInlineImageBufferState,
  chunk: Uint8Array
): Effect.Effect<TerminalInlineImageBufferState, TerminalInlineImageFetchError> => {
  const nextSize = state.size + chunk.byteLength
  return validateTerminalInlineImageSize(nextSize).pipe(
    Effect.as({
      chunks: [...state.chunks, chunk],
      size: nextSize
    })
  )
}

const copyChunkToArrayBuffer = (chunk: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(chunk.byteLength)
  copy.set(chunk)
  return copy.buffer
}

const imageBlobFromChunks = (
  chunks: ReadonlyArray<Uint8Array>,
  mediaType: string | undefined
): Blob =>
  new Blob(
    chunks.map((chunk) => copyChunkToArrayBuffer(chunk)),
    mediaType === undefined ? {} : { type: mediaType }
  )

const readTerminalInlineImageBlob = (
  response: HttpClientResponse.HttpClientResponse
): Effect.Effect<Blob, TerminalInlineImageFetchError> => {
  const contentLength = readContentLength(response.headers)
  if (contentLength !== null && contentLength > terminalInlineImageMaxBytes) {
    return Effect.fail(terminalInlineImageFetchError("Terminal image is too large."))
  }
  return HttpClientResponse.stream(Effect.succeed(response)).pipe(
    Stream.runFoldEffect(emptyTerminalInlineImageBufferState, appendTerminalInlineImageChunk),
    Effect.map((state) => imageBlobFromChunks(state.chunks, response.headers["content-type"])),
    Effect.mapError(() => terminalInlineImageFetchError("Could not read terminal image response."))
  )
}

const fetchTerminalInlineImageBlob = (
  fetchUrl: string
): Effect.Effect<Blob, TerminalInlineImageFetchError> =>
  Effect.gen(function*(_) {
    const client = yield* _(HttpClient.HttpClient)
    const response = yield* _(
      client.get(fetchUrl, { headers: terminalInlineImageFetchHeaders }).pipe(
        Effect.mapError(() => terminalInlineImageFetchError("Could not fetch terminal image."))
      )
    )
    if (response.status >= 400) {
      return yield* _(Effect.fail(terminalInlineImageFetchError(`Terminal image returned HTTP ${response.status}.`)))
    }
    return yield* _(readTerminalInlineImageBlob(response))
  }).pipe(
    Effect.timeoutFail({
      duration: terminalInlineImageFetchTimeout,
      onTimeout: () => terminalInlineImageFetchError("Terminal image fetch timed out.")
    }),
    Effect.provide(FetchHttpClient.layer)
  )

const loadTerminalImageEntry = (
  handlers: TerminalMessageHandlers,
  path: string,
  onComplete: (entry: TerminalInlineImageEntry) => void
): void => {
  const fetchUrl = resolveTerminalImageFetchUrl(handlers.session.websocketPath, path)
  const cached = cachedTerminalInlineImageEntry(handlers.lifecycle.inlineImageObjectUrls, path, fetchUrl)
  if (cached !== null) {
    onComplete(cached)
    return
  }
  Effect.runFork(
    fetchTerminalInlineImageBlob(fetchUrl).pipe(
      Effect.match({
        onFailure: () => unavailableTerminalInlineImageEntry(path, fetchUrl),
        onSuccess: (blob) =>
          handlers.lifecycle.disposed
            ? null
            : cacheTerminalInlineImageBlob(handlers.lifecycle.inlineImageObjectUrls, path, fetchUrl, blob)
      }),
      Effect.flatMap((entry) =>
        Effect.sync(() => {
          if (entry === null || handlers.lifecycle.disposed) {
            return
          }
          onComplete(entry)
        })
      )
    )
  )
}

const writePreviewSpacer = (
  handlers: TerminalMessageHandlers,
  onComplete: () => void
): void => {
  handlers.terminal.write(terminalInlineImageSpacer, onComplete)
}

const writeInlineImagePreview = (
  handlers: TerminalMessageHandlers,
  path: string,
  onComplete: () => void
): void => {
  const cached = terminalImageEntry(handlers, path)
  if (cached !== null) {
    writeInlineImagePreviewEntry(handlers, cached, onComplete)
    return
  }
  loadTerminalImageEntry(handlers, path, (entry) => {
    writeInlineImagePreviewEntry(handlers, entry, onComplete)
  })
}

const writeInlineImagePreviewEntry = (
  handlers: TerminalMessageHandlers,
  entry: TerminalInlineImageEntry,
  onComplete: () => void
): void => {
  const isAppended = appendTerminalInlineImagePreview(
    handlers.terminal,
    handlers.lifecycle,
    entry
  )
  if (!isAppended) {
    onComplete()
    return
  }
  writePreviewSpacer(handlers, onComplete)
}

const writeInlineImagePreviews = (
  handlers: TerminalMessageHandlers,
  paths: ReadonlyArray<string>,
  onComplete: () => void
): void => {
  let index = 0
  const writeNext = (): void => {
    const path = paths[index]
    if (path === undefined) {
      onComplete()
      return
    }
    index += 1
    writeInlineImagePreview(handlers, path, writeNext)
  }
  writeNext()
}

const writeLineBreakBeforePreview = (
  handlers: TerminalMessageHandlers,
  segment: TerminalInlineImageOutputSegment,
  onComplete: () => void
): void => {
  if (segment.endedWithLineBreak) {
    onComplete()
    return
  }
  handlers.terminal.write("\r\n", onComplete)
}

const flushTerminalOutputQueue = (handlers: TerminalMessageHandlers): void => {
  if (handlers.lifecycle.outputWriting || handlers.lifecycle.disposed) {
    return
  }
  const segment = handlers.lifecycle.outputQueue.shift()
  if (segment === undefined) {
    return
  }

  handlers.lifecycle.outputWriting = true
  writeTerminalOutputSegment({
    inlineImagePreviewsEnabledRef: handlers.inlineImagePreviewsEnabledRef,
    segment,
    writer: {
      writePreviewLineBreak: (outputSegment, onComplete) => {
        writeLineBreakBeforePreview(handlers, outputSegment, onComplete)
      },
      writePreviews: (paths, onComplete) => {
        writeInlineImagePreviews(handlers, paths, onComplete)
      },
      writeText: (text, onComplete) => {
        handlers.terminal.write(text, onComplete)
      }
    }
  }, () => {
    handlers.lifecycle.outputWriting = false
    flushTerminalOutputQueue(handlers)
  })
}

/**
 * Enqueues terminal output segments and starts the sequential terminal flush loop.
 *
 * @param handlers - Runtime terminal handlers with mutable lifecycle queues and flags.
 * @param data - Raw terminal output chunk to split into text and inline-image preview segments.
 * @returns Nothing; lifecycle state is updated through `handlers`.
 * @pure false
 * @effect TerminalMessageHandlers.lifecycle outputQueue/outputWriting/disposed and terminal writes.
 * @invariant `outputWriting` acts as a semaphore: at most one flush writes to the terminal at a time.
 * @precondition `handlers.lifecycle.outputQueue` is an array, `outputWriting` is boolean, and handlers are live.
 * @postcondition All split segments are appended before `flushTerminalOutputQueue(handlers)` is invoked.
 * @complexity O(n) where n is the number of output segments parsed from `data`.
 * @throws Never
 */
// CHANGE: document terminal output queueing as the shell boundary for inline image writes
// WHY: queue order and the outputWriting semaphore protect terminal write ordering across async previews
// QUOTE(ТЗ): "Limit inline-preview loading by timeout and size without freezing terminal output"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: enqueue(q, segments) -> flush observes q followed by segments in input order
// PURITY: SHELL
// EFFECT: TerminalMessageHandlers -> mutates lifecycle.outputQueue/outputWriting and writes to terminal
// INVARIANT: disposed handlers never start a new flush, and flush is called only after queue append
// COMPLEXITY: O(n) where n is the number of output segments parsed from `data`
export const enqueueTerminalOutput = (
  handlers: TerminalMessageHandlers,
  data: string
): void => {
  for (const segment of splitTerminalInlineImageOutput(data)) {
    handlers.lifecycle.outputQueue.push(segment)
  }
  flushTerminalOutputQueue(handlers)
}
