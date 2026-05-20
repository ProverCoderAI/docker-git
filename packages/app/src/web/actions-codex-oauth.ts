import { Effect } from "effect"

import { codexLoginFailureMessage, codexLoginStreamMarkers } from "../shared/auth-stream-markers.js"
import {
  applyAuthSuccessState,
  type BrowserActionContext,
  defaultLabel,
  nullableValue,
  withBusy
} from "./actions-shared.js"
import { runVisibleAuthStreamMutation } from "./actions-visible-auth-stream.js"
import { loadAuthSnapshot, loadGithubStatus, loginCodexStream, logoutCodex } from "./api.js"

export const runCodexOauthMutation = (
  values: Readonly<Record<string, string>>,
  context: BrowserActionContext
) => {
  runVisibleAuthStreamMutation({
    busyLabel: "Running Codex OAuth",
    context,
    failureMessage: codexLoginFailureMessage,
    markers: codexLoginStreamMarkers,
    runStream: loginCodexStream,
    startMessage: "Codex OAuth запущен. Следуй инструкциям в Output.",
    successMessage: (label) => `Saved Codex login (${label}).`,
    values
  })
}

export const runCodexLogoutMutation = (
  values: Readonly<Record<string, string>>,
  context: BrowserActionContext
) => {
  const label = defaultLabel(values["label"])
  withBusy({
    context,
    effect: logoutCodex(nullableValue(values["label"])).pipe(
      Effect.zipRight(Effect.all({
        githubStatus: loadGithubStatus(),
        snapshot: loadAuthSnapshot()
      }))
    ),
    label: "CodexLogout",
    onSuccess: ({ githubStatus, snapshot }) => {
      applyAuthSuccessState(context, {
        githubStatus,
        message: `Logged out Codex CLI (${label}).`,
        snapshot
      })
    }
  })
}
