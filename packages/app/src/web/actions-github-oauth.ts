import { githubLoginFailureMessage, githubLoginStreamMarkers } from "../shared/auth-stream-markers.js"
import type { BrowserActionContext } from "./actions-shared.js"
import { runVisibleAuthStreamMutation } from "./actions-visible-auth-stream.js"
import { loginGithubStream } from "./api.js"

export const runGithubOauthMutation = (
  values: Readonly<Record<string, string>>,
  context: BrowserActionContext
) => {
  runVisibleAuthStreamMutation({
    busyLabel: "Running GitHub OAuth",
    context,
    failureMessage: githubLoginFailureMessage,
    markers: githubLoginStreamMarkers,
    onSuccess: () => {
      context.reloadDashboard()
    },
    runStream: loginGithubStream,
    startMessage: "GitHub OAuth запущен. Следуй инструкциям в Output.",
    successMessage: (label) => `Saved GitHub token (${label}).`,
    values
  })
}
