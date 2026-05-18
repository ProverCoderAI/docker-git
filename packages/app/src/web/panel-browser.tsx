import type { JSX } from "react"

import { Box, Text } from "../ui/primitives.js"
import { projectBrowserCdpUrl, projectBrowserNoVncUrl, type ProjectBrowserSession, type ProjectSummary } from "./api.js"
import { canOpenProjectBrowser } from "./app-ready-browser-openable.js"

type BrowserPanelProps = {
  readonly browser: ProjectBrowserSession | null
  readonly onOpenBrowser: () => void
  readonly onRefreshBrowser: () => void
  readonly selectedProjectSummary: ProjectSummary | undefined
}

const statusColor = (status: ProjectBrowserSession["status"]): string => {
  if (status === "running") {
    return "#56f39a"
  }
  if (status === "missing") {
    return "#ff8aa0"
  }
  if (status === "stopped") {
    return "#ffb86c"
  }
  return "#ffd166"
}

const openUrl = (url: string): void => {
  if (typeof globalThis.open === "function") {
    globalThis.open(url, "_blank", "noopener")
  }
}

const BrowserLinks = ({ browser }: { readonly browser: ProjectBrowserSession }): JSX.Element => {
  const noVncUrl = projectBrowserNoVncUrl(browser)
  const cdpUrl = projectBrowserCdpUrl(browser)
  return (
    <Box flexDirection="column" gap={1} marginTop={1}>
      <Box
        onClick={() => {
          openUrl(noVncUrl)
        }}
      >
        <Text fg="#7fdfff" wrap="truncate">UI: {noVncUrl}</Text>
      </Box>
      <Box
        onClick={() => {
          openUrl(cdpUrl)
        }}
      >
        <Text fg="#9fd7ff" wrap="truncate">CDP: {cdpUrl}</Text>
      </Box>
    </Box>
  )
}

const BrowserStatusDetails = (
  {
    browser,
    canOpenBrowser
  }: {
    readonly browser: ProjectBrowserSession | null
    readonly canOpenBrowser: boolean
  }
): JSX.Element => {
  if (browser === null) {
    return <Text fg="#8fa6c4" marginTop={1}>Browser status is not loaded.</Text>
  }
  return (
    <Box flexDirection="column" gap={1} marginTop={1}>
      <Box alignItems="center" flexWrap="wrap" gap={1} justifyContent="space-between">
        <Text fg="#8fa6c4" wrap="truncate">Container: {browser.containerName}</Text>
        <Text bold={true} fg={statusColor(browser.status)}>{browser.status}</Text>
      </Box>
      {canOpenBrowser
        ? <BrowserLinks browser={browser} />
        : (
          <Text fg="#ffb86c" wrap="wrap">
            Enable Playwright MCP for this project and start it before opening the browser.
          </Text>
        )}
    </Box>
  )
}

const BrowserActions = (
  {
    canOpenBrowser,
    onOpenBrowser,
    onRefreshBrowser
  }: Pick<BrowserPanelProps, "onOpenBrowser" | "onRefreshBrowser"> & { readonly canOpenBrowser: boolean }
): JSX.Element => (
  <Box flexWrap="wrap" gap={1} marginTop={1}>
    {canOpenBrowser
      ? (
        <Box onClick={onOpenBrowser} width="auto">
          <Text bold={true} fg="#78f0a3">open browser</Text>
        </Box>
      )
      : <Text bold={true} fg="#8fa6c4">open browser</Text>}
    <Box onClick={onRefreshBrowser} width="auto">
      <Text bold={true} fg="#7fdfff">refresh</Text>
    </Box>
  </Box>
)

export const BrowserPanel = (
  {
    browser,
    onOpenBrowser,
    onRefreshBrowser,
    selectedProjectSummary
  }: BrowserPanelProps
): JSX.Element => {
  const canOpenBrowser = canOpenProjectBrowser(browser, selectedProjectSummary?.id ?? null)
  return (
    <Box flexDirection="column">
      <Text bold={true} fg="#8be9fd">Browser</Text>
      <Text fg="#d6e5f7" wrap="wrap">
        Open the Playwright browser runtime for the selected project.
      </Text>
      <Text fg="#8fa6c4" marginTop={1} wrap="truncate">
        Project: {selectedProjectSummary?.displayName ?? "not selected"}
      </Text>
      <BrowserStatusDetails browser={browser} canOpenBrowser={canOpenBrowser} />
      <BrowserActions
        canOpenBrowser={canOpenBrowser}
        onOpenBrowser={onOpenBrowser}
        onRefreshBrowser={onRefreshBrowser}
      />
    </Box>
  )
}
