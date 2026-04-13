import { Effect } from "effect"

import {
  authStreamMarkerExitCode,
  authStreamSucceeded,
  githubLoginFailureMessage,
  githubLoginStreamMarkers,
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
import { loadAuthSnapshot, loadGithubStatus, loginGithubStream } from "./api.js"

export const runGithubOauthMutation = (
  values: Readonly<Record<string, string>>,
  context: BrowserActionContext
) => {
  const label = defaultLabel(values["label"])
  const writer = makeVisibleAuthStreamWriter(githubLoginStreamMarkers, (chunk) => {
    appendOutputChunk(context, chunk)
  })
  context.setOutput("")
  context.setMessage("GitHub OAuth запущен. Следуй инструкциям в Output.")
  withBusy({
    context,
    effect: loginGithubStream(nullableValue(values["label"]), writer.writeChunk).pipe(
      Effect.ensuring(Effect.sync(writer.flushVisiblePending)),
      Effect.flatMap((output) =>
        authStreamSucceeded(output, githubLoginStreamMarkers)
          ? Effect.all({
            githubStatus: loadGithubStatus(),
            snapshot: loadAuthSnapshot()
          })
          : Effect.fail(githubLoginFailureMessage(
            output,
            authStreamMarkerExitCode(output, githubLoginStreamMarkers)
          ))
      )
    ),
    label: "Running GitHub OAuth",
    onSuccess: ({ githubStatus, snapshot }) => {
      applyAuthSuccessState(context, {
        githubStatus,
        message: `Saved GitHub token (${label}).`,
        snapshot
      })
    }
  })
}
