import { type BrowserActionContext, withBusy } from "./actions-shared.js"
import { openSkiller } from "./api.js"
import { openUrl } from "./open-url.js"

type SkillerLaunch = {
  readonly alreadyRunning: boolean
  readonly appPath: string
  readonly logPath: string
  readonly pid: number | null
  readonly trpcBasePath: string
}

const skillerLaunchMessage = (launch: SkillerLaunch): string => {
  const pid = launch.pid === null ? "unknown pid" : `pid ${launch.pid}`
  const state = launch.alreadyRunning
    ? `Skiller is already running (${pid}). Log: ${launch.logPath}`
    : `Skiller launch started (${pid}). Log: ${launch.logPath}`
  return openUrl(launch.appPath)
    ? `${state}. Opened ${launch.appPath}.`
    : `${state}. Popup was blocked. Open ${launch.appPath} manually.`
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
