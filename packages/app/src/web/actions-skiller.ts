import { type BrowserActionContext, withBusy } from "./actions-shared.js"
import { openSkiller } from "./api.js"
import { openUrl } from "./open-url.js"

type SkillerLaunch = {
  readonly alreadyRunning: boolean
  readonly appPath: string
  readonly logPath: string
  readonly pid: number | null
  readonly scope: {
    readonly containerName: string
    readonly containerProjectPath: string
  } | null
  readonly trpcBasePath: string
}

const skillerLaunchMessage = (launch: SkillerLaunch): string => {
  const pid = launch.pid === null ? "unknown pid" : `pid ${launch.pid}`
  const state = launch.alreadyRunning
    ? `Skiller is already running (${pid}). Log: ${launch.logPath}`
    : `Skiller launch started (${pid}). Log: ${launch.logPath}`
  const scope = launch.scope === null
    ? ""
    : ` Container FS: ${launch.scope.containerName}:${launch.scope.containerProjectPath}.`
  return openUrl(launch.appPath)
    ? `${state}.${scope} Opened ${launch.appPath}.`
    : `${state}.${scope} Popup was blocked. Open ${launch.appPath} manually.`
}

export const openSkillerApp = (
  context: BrowserActionContext,
  projectKey: string | null | undefined = context.selectedProjectKey
): void => {
  const resolvedProjectKey = projectKey ?? undefined
  withBusy({
    context,
    effect: openSkiller(resolvedProjectKey),
    label: "Opening Skiller",
    onSuccess: (launch) => {
      context.setMessage(skillerLaunchMessage(launch))
    }
  })
}
