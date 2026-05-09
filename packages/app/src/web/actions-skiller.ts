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

const skillerAppPathForSession = (sessionId: string): string =>
  `/api/ssh/session/${encodeURIComponent(sessionId)}/skiller/app/`

const skillerLaunchMessage = (launch: SkillerLaunch, openedPath: string, opened: boolean): string => {
  const pid = launch.pid === null ? "unknown pid" : `pid ${launch.pid}`
  const state = launch.alreadyRunning
    ? `Skiller is already running (${pid}). Log: ${launch.logPath}`
    : `Skiller launch started (${pid}). Log: ${launch.logPath}`
  const scope = launch.scope === null
    ? ""
    : ` Container FS: ${launch.scope.containerName}:${launch.scope.containerProjectPath}.`
  return opened
    ? `${state}.${scope} Opened ${openedPath}.`
    : `${state}.${scope} Popup was blocked. Open ${openedPath} manually.`
}

export const openSkillerApp = (
  context: BrowserActionContext,
  projectKey: string | null | undefined = context.selectedProjectKey,
  sessionId?: string
): void => {
  const resolvedProjectKey = projectKey ?? undefined
  const immediateAppPath = sessionId === undefined ? null : skillerAppPathForSession(sessionId)
  const immediateOpenResult = immediateAppPath === null ? null : openUrl(immediateAppPath)
  withBusy({
    context,
    effect: openSkiller(resolvedProjectKey, sessionId),
    label: "Opening Skiller",
    onSuccess: (launch) => {
      const openedPath = immediateAppPath ?? launch.appPath
      const opened = immediateOpenResult ?? openUrl(openedPath)
      context.setMessage(skillerLaunchMessage(launch, openedPath, opened))
    }
  })
}
