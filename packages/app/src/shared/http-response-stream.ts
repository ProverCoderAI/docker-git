import { HttpClientResponse } from "@effect/platform"
import { Effect } from "effect"
import * as Stream from "effect/Stream"

export const readHttpResponseTextStream = (
  response: HttpClientResponse.HttpClientResponse,
  onChunk: (chunk: string) => void
) =>
  HttpClientResponse.stream(Effect.succeed(response)).pipe(
    Stream.decodeText(),
    Stream.runFoldEffect("", (output, chunk) =>
      Effect.sync(() => {
        onChunk(chunk)
        return output + chunk
      }))
  )
