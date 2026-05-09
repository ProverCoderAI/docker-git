import { type BrowserActionContext, withBusy } from "./actions-shared.js"
import { openSkiller } from "./api.js"

type SkillerLaunch = {
  readonly alreadyRunning: boolean
  readonly logPath: string
  readonly pid: number | null
}

const skillerLaunchMessage = (launch: SkillerLaunch): string => {
  const pid = launch.pid === null ? "unknown pid" : `pid ${launch.pid}`
  return launch.alreadyRunning
    ? `Skiller is already running (${pid}). Log: ${launch.logPath}`
    : `Skiller launch started (${pid}). Log: ${launch.logPath}`
}

export const openSkillerApp = (context: BrowserActionContext): void => {
  withBusy({
    context,
    effect: openSkiller(),
    label: "Opening Skiller",
    onSuccess: (launch) => {
      context.setMessage(skillerLaunchMessage(launch))
    }
  })
}
