import { Effect } from "effect"

import {
  authStreamMarkerExitCode,
  type AuthStreamMarkers,
  didAuthStreamSucceed,
  makeVisibleAuthStreamWriter
} from "../shared/auth-stream-markers.js"
import {
  appendOutputChunk,
  applyAuthSuccessState,
  type BrowserActionContext,
  defaultLabel,
  nullableValue,
  withBusy
} from "./actions-shared.js"
import { loadAuthSnapshot, loadGithubStatus } from "./api.js"

type AuthStreamRunner = (
  label: string | null,
  onChunk: (chunk: string) => void
) => Effect.Effect<string, string>

type VisibleAuthStreamMutationConfig = {
  readonly busyLabel: string
  readonly context: BrowserActionContext
  readonly failureMessage: (output: string, exitCode: string | null) => string
  readonly markers: AuthStreamMarkers
  readonly onSuccess?: () => void
  readonly runStream: AuthStreamRunner
  readonly startMessage: string
  readonly successMessage: (label: string) => string
  readonly values: Readonly<Record<string, string>>
}

export const runVisibleAuthStreamMutation = (config: VisibleAuthStreamMutationConfig) => {
  const label = defaultLabel(config.values["label"])
  const writer = makeVisibleAuthStreamWriter(config.markers, (chunk) => {
    appendOutputChunk(config.context, chunk)
  })
  config.context.setOutput("")
  config.context.setMessage(config.startMessage)
  const flushVisiblePending = Effect.sync(writer.flushVisiblePending)
  withBusy({
    context: config.context,
    effect: config.runStream(nullableValue(config.values["label"]), writer.writeChunk).pipe(
      Effect.ensuring(flushVisiblePending),
      Effect.flatMap((output) =>
        didAuthStreamSucceed(output, config.markers)
          ? Effect.all({
            githubStatus: loadGithubStatus(),
            snapshot: loadAuthSnapshot()
          })
          : Effect.fail(config.failureMessage(
            output,
            authStreamMarkerExitCode(output, config.markers)
          ))
      )
    ),
    label: config.busyLabel,
    onSuccess: ({ githubStatus, snapshot }) => {
      applyAuthSuccessState(config.context, {
        githubStatus,
        message: config.successMessage(label),
        snapshot
      })
      if (config.onSuccess !== undefined) {
        config.onSuccess()
      }
    }
  })
}
