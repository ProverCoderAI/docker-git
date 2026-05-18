import type { JSX } from "react"

import { Box, Text } from "../ui/primitives.js"
import type { PanelCloudflareTunnelSession } from "./api.js"

type SharePanelProps = {
  readonly onCopyPublicUrl: (publicUrl: string) => void
  readonly onRefresh: () => void
  readonly onStart: () => void
  readonly onStop: () => void
  readonly tunnel: PanelCloudflareTunnelSession | null
}

const statusColor = (status: PanelCloudflareTunnelSession["status"] | "none"): string => {
  if (status === "running") {
    return "#56f39a"
  }
  if (status === "starting") {
    return "#ffd166"
  }
  if (status === "failed") {
    return "#ff8aa0"
  }
  return "#8fa6c4"
}

const openUrl = (url: string): void => {
  if (typeof globalThis.open !== "function" || !URL.canParse(url)) {
    return
  }
  const parsed = new URL(url)
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    globalThis.open(parsed.toString(), "_blank", "noopener")
  }
}

const ActionButton = (
  {
    fg = "#78f0a3",
    label,
    onClick
  }: {
    readonly fg?: string | undefined
    readonly label: string
    readonly onClick: () => void
  }
): JSX.Element => (
  <Box onClick={onClick} width="auto">
    <Text bold={true} fg={fg}>{label}</Text>
  </Box>
)

const TunnelPublicUrl = (
  {
    onCopyPublicUrl,
    publicUrl
  }: {
    readonly onCopyPublicUrl: (publicUrl: string) => void
    readonly publicUrl: string
  }
): JSX.Element => (
  <Box border={true} borderColor="#3a4652" flexDirection="column" gap={1} marginTop={1} padding={1}>
    <Text bold={true} fg="#8be9fd">Public panel URL</Text>
    <Box
      onClick={() => {
        openUrl(publicUrl)
      }}
    >
      <Text fg="#7fdfff" wrap="truncate">{publicUrl}</Text>
    </Box>
    <Box flexWrap="wrap" gap={1}>
      <ActionButton
        label="open"
        onClick={() => {
          openUrl(publicUrl)
        }}
      />
      <ActionButton
        fg="#7fdfff"
        label="copy"
        onClick={() => {
          onCopyPublicUrl(publicUrl)
        }}
      />
    </Box>
  </Box>
)

const TunnelLogs = (
  { lines }: { readonly lines: ReadonlyArray<string> }
): JSX.Element | null =>
  lines.length === 0
    ? null
    : (
      <Box border={true} borderColor="#3a4652" flexDirection="column" marginTop={1} padding={1}>
        <Text bold={true} fg="#8be9fd">cloudflared log</Text>
        {lines.slice(-8).map((line, index) => <Text key={`${index}-${line}`} fg="#8fa6c4" wrap="truncate">{line}
        </Text>)}
      </Box>
    )

const tunnelStatus = (tunnel: PanelCloudflareTunnelSession | null): PanelCloudflareTunnelSession["status"] | "none" =>
  tunnel === null ? "none" : tunnel.status

const tunnelPanelUrl = (tunnel: PanelCloudflareTunnelSession | null): string =>
  tunnel === null ? "local browser origin" : tunnel.panelUrl

const MaybeTunnelPublicUrl = (
  {
    onCopyPublicUrl,
    tunnel
  }: {
    readonly onCopyPublicUrl: (publicUrl: string) => void
    readonly tunnel: PanelCloudflareTunnelSession | null
  }
): JSX.Element | null =>
  tunnel === null || tunnel.publicUrl === null
    ? null
    : <TunnelPublicUrl onCopyPublicUrl={onCopyPublicUrl} publicUrl={tunnel.publicUrl} />

const MaybeTunnelError = (
  { tunnel }: { readonly tunnel: PanelCloudflareTunnelSession | null }
): JSX.Element | null =>
  tunnel === null || tunnel.error === null
    ? null
    : <Text fg="#ff8aa0" marginTop={1} wrap="wrap">{tunnel.error}</Text>

const tunnelLogTail = (tunnel: PanelCloudflareTunnelSession | null): ReadonlyArray<string> =>
  tunnel === null ? [] : tunnel.logTail

export const SharePanel = (
  {
    onCopyPublicUrl,
    onRefresh,
    onStart,
    onStop,
    tunnel
  }: SharePanelProps
): JSX.Element => {
  const status = tunnelStatus(tunnel)
  return (
    <Box flexDirection="column">
      <Box alignItems="center" flexWrap="wrap" gap={1} justifyContent="space-between">
        <Text bold={true} fg="#8be9fd">Share panel</Text>
        <Text fg={statusColor(status)}>{status}</Text>
      </Box>
      <Box flexWrap="wrap" gap={1} marginTop={1}>
        <ActionButton label="start tunnel" onClick={onStart} />
        <ActionButton fg="#7fdfff" label="refresh" onClick={onRefresh} />
        <ActionButton fg="#ff8aa0" label="stop" onClick={onStop} />
      </Box>
      <Text fg="#ffd166" marginTop={1} wrap="wrap">
        Anyone with the public URL can access the current dashboard.
      </Text>
      <Text fg="#8fa6c4" marginTop={1} wrap="truncate">
        Panel: {tunnelPanelUrl(tunnel)}
      </Text>
      <MaybeTunnelPublicUrl onCopyPublicUrl={onCopyPublicUrl} tunnel={tunnel} />
      <MaybeTunnelError tunnel={tunnel} />
      <TunnelLogs lines={tunnelLogTail(tunnel)} />
    </Box>
  )
}
