import { Effect } from "effect"

import {
  authStreamMarkerExitCode,
  authStreamSucceeded,
  codexLoginFailureMessage,
  codexLoginStreamMarkers,
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
import { loadAuthSnapshot, loadGithubStatus, loginCodexStream } from "./api.js"

export const runCodexOauthMutation = (
  values: Readonly<Record<string, string>>,
  context: BrowserActionContext
) => {
  const label = defaultLabel(values["label"])
  const writer = makeVisibleAuthStreamWriter(codexLoginStreamMarkers, (chunk) => {
    appendOutputChunk(context, chunk)
  })
  context.setOutput("")
  context.setMessage("Codex OAuth запущен. Следуй инструкциям в Output.")
  withBusy({
    context,
    effect: loginCodexStream(nullableValue(values["label"]), writer.writeChunk).pipe(
      Effect.ensuring(Effect.sync(writer.flushVisiblePending)),
      Effect.flatMap((output) =>
        authStreamSucceeded(output, codexLoginStreamMarkers)
          ? Effect.all({
            githubStatus: loadGithubStatus(),
            snapshot: loadAuthSnapshot()
          })
          : Effect.fail(codexLoginFailureMessage(
            output,
            authStreamMarkerExitCode(output, codexLoginStreamMarkers)
          ))
      )
    ),
    label: "Running Codex OAuth",
    onSuccess: ({ githubStatus, snapshot }) => {
      applyAuthSuccessState(context, {
        githubStatus,
        message: `Saved Codex login (${label}).`,
        snapshot
      })
    }
  })
}
