import { type BrowserActionContext, withBusy } from "./actions-shared.js"
import { openSkiller } from "./api.js"
import { type PreparedOpenUrl, prepareOpenUrl } from "./open-url.js"

export type SkillerLaunch = {
  readonly alreadyRunning: boolean
  readonly appPath: string
  readonly backendUrl: string | null
  readonly logPath: string
  readonly mode: "bundled" | "external"
  readonly pid: number | null
  readonly scope: {
    readonly containerName: string
    readonly containerProjectPath: string
  } | null
  readonly trpcBasePath: string
}

export const skillerLaunchMessage = (launch: SkillerLaunch, openedPath: string, opened: boolean): string => {
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

export const openPreparedSkillerLaunch = (launch: SkillerLaunch, preparedUrl: PreparedOpenUrl): string => {
  const openedPath = launch.appPath
  const opened = preparedUrl.navigate(openedPath)
  if (launch.mode === "external") {
    const scope = launch.scope === null
      ? ""
      : ` Container FS: ${launch.scope.containerName}:${launch.scope.containerProjectPath}.`
    return opened
      ? `Skiller Web opened.${scope} Opened ${openedPath}.`
      : `Skiller Web popup was blocked.${scope} Open ${openedPath} manually.`
  }
  return skillerLaunchMessage(launch, openedPath, opened)
}

export const openSkillerApp = (
  context: BrowserActionContext,
  projectKey: string | null | undefined = context.selectedProjectKey,
  sessionId?: string
): void => {
  const resolvedProjectKey = projectKey ?? undefined
  const preparedUrl = prepareOpenUrl()
  context.setMessage("Opening Skiller...")
  withBusy({
    context,
    effect: openSkiller(resolvedProjectKey, sessionId),
    label: "Opening Skiller",
    onFailure: () => {
      preparedUrl.close()
    },
    onSuccess: (launch) => {
      context.setMessage(openPreparedSkillerLaunch(launch, preparedUrl))
    }
  })
}
