import { type TerminalAuthFlow, terminalAuthTitle } from "../docker-git/menu-auth-shared.js"
import { type BrowserActionContext, defaultLabel, nullableValue, withBusy } from "./actions-shared.js"
import { createAuthTerminalSession } from "./api.js"

export const runTerminalOnlyAuthAction = (
  action: TerminalAuthFlow,
  values: Readonly<Record<string, string>>,
  context: BrowserActionContext
) => {
  const provider = terminalAuthTitle(action)
  const label = nullableValue(values["label"])
  const sessionLabel = defaultLabel(values["label"])
  withBusy({
    context,
    effect: createAuthTerminalSession(action, label),
    label: provider,
    onSuccess: (session) => {
      context.setActionPrompt(null)
      context.addTerminalSession({
        closePath: `/auth/terminal-sessions/${encodeURIComponent(session.id)}`,
        exitMessage: `${provider} finished (${sessionLabel}).`,
        header: provider,
        pendingDeleteMessage: `${provider} was closed before attach.`,
        readyMessage: `${provider} started (${sessionLabel}).`,
        session,
        subtitle: session.sshCommand,
        websocketPath: `/auth/terminal-sessions/${encodeURIComponent(session.id)}/ws`
      })
      context.setMessage(`${provider} is opening in the embedded terminal.`)
    }
  })
}
