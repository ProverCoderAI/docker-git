import type { JSX } from "react"

import { Box, Text } from "../ui/primitives.js"
import { projectBrowserCdpUrl, projectBrowserNoVncUrl, type ProjectBrowserSession, type ProjectSummary } from "./api.js"

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

export const BrowserPanel = (
  {
    browser,
    onOpenBrowser,
    onRefreshBrowser,
    selectedProjectSummary
  }: BrowserPanelProps
): JSX.Element => (
  <Box flexDirection="column">
    <Text bold={true} fg="#8be9fd">Browser</Text>
    <Text fg="#d6e5f7" wrap="wrap">
      Open the Playwright browser sidecar for the selected project.
    </Text>
    <Text fg="#8fa6c4" marginTop={1} wrap="truncate">
      Project: {selectedProjectSummary?.displayName ?? "not selected"}
    </Text>
    {browser === null
      ? <Text fg="#8fa6c4" marginTop={1}>Browser status is not loaded.</Text>
      : (
        <Box flexDirection="column" gap={1} marginTop={1}>
          <Box alignItems="center" flexWrap="wrap" gap={1} justifyContent="space-between">
            <Text fg="#8fa6c4" wrap="truncate">Container: {browser.containerName}</Text>
            <Text bold={true} fg={statusColor(browser.status)}>{browser.status}</Text>
          </Box>
          {browser.status === "running"
            ? <BrowserLinks browser={browser} />
            : (
              <Text fg="#ffb86c" wrap="wrap">
                Enable Playwright MCP for this project and start it before opening the browser.
              </Text>
            )}
        </Box>
      )}
    <Box flexWrap="wrap" gap={1} marginTop={1}>
      <Box onClick={onOpenBrowser} width="auto">
        <Text bold={true} fg="#78f0a3">open browser</Text>
      </Box>
      <Box onClick={onRefreshBrowser} width="auto">
        <Text bold={true} fg="#7fdfff">refresh</Text>
      </Box>
    </Box>
  </Box>
)
