import { Effect } from "effect"
import { type Dispatch, type JSX, type SetStateAction, useCallback, useEffect, useRef, useState } from "react"

import { Box, Text } from "../ui/primitives.js"
import type { ShareLinkInfo } from "./api-share-links.js"
import { createProjectShareLink, deleteProjectShareLink, listProjectShareLinks } from "./api-share-links.js"
import type { PanelCloudflareTunnelSession } from "./api.js"

type SharePanelProps = {
  readonly onCopyPublicUrl: (publicUrl: string) => void
  readonly onRefresh: () => void
  readonly onStart: () => void
  readonly onStop: () => void
  readonly selectedProjectKey: string | null
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
  if (typeof open !== "function" || !URL.canParse(url)) {
    return
  }
  const parsed = new URL(url)
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    open(parsed.href, "_blank", "noopener")
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

type ShareLinksState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Loaded"; readonly links: ReadonlyArray<ShareLinkInfo>; readonly newUrl: string | null }
  | { readonly _tag: "Error"; readonly message: string }

const runRefreshLinks = (
  projectKey: string,
  id: number,
  idRef: { readonly current: number },
  setState: Dispatch<SetStateAction<ShareLinksState>>
): void => {
  setState({ _tag: "Loading" })
  void Effect.runPromise(
    listProjectShareLinks(projectKey).pipe(
      Effect.match({
        onFailure: (msg) => {
          if (idRef.current === id) setState({ _tag: "Error", message: msg })
        },
        onSuccess: (links) => {
          if (idRef.current !== id) return
          setState((s) => ({ _tag: "Loaded", links, newUrl: s._tag === "Loaded" ? s.newUrl : null }))
        }
      })
    )
  )
}

const runGenerateLink = (
  projectKey: string,
  id: number,
  idRef: { readonly current: number },
  setState: Dispatch<SetStateAction<ShareLinksState>>
): void => {
  void Effect.runPromise(
    createProjectShareLink(projectKey).pipe(
      Effect.flatMap(({ url }) =>
        listProjectShareLinks(projectKey).pipe(
          Effect.map((links) => {
            if (idRef.current === id) setState({ _tag: "Loaded", links, newUrl: url })
          })
        )
      ),
      Effect.catchAll((msg) =>
        Effect.sync(() => {
          if (idRef.current === id) setState({ _tag: "Error", message: msg })
        })
      )
    )
  )
}

const runRevokeLink = (
  projectKey: string,
  token: string,
  id: number,
  idRef: { readonly current: number },
  setState: Dispatch<SetStateAction<ShareLinksState>>
): void => {
  void Effect.runPromise(
    deleteProjectShareLink(projectKey, token).pipe(
      Effect.flatMap(() => listProjectShareLinks(projectKey)),
      Effect.match({
        onFailure: (msg) => {
          if (idRef.current === id) setState({ _tag: "Error", message: msg })
        },
        onSuccess: (links) => {
          if (idRef.current !== id) return
          setState((s) => ({ _tag: "Loaded", links, newUrl: s._tag === "Loaded" ? s.newUrl : null }))
        }
      })
    )
  )
}

const ShareLinkNewBanner = (
  { newUrl }: { readonly newUrl: string }
): JSX.Element => (
  <Box border={true} borderColor="#56f39a" flexDirection="column" gap={1} padding={1}>
    <Text bold={true} fg="#56f39a">New share link</Text>
    <Text fg="#7fdfff" wrap="wrap">{newUrl}</Text>
    <Box flexWrap="wrap" gap={1}>
      <ActionButton
        fg="#7fdfff"
        label="copy"
        onClick={() => {
          void navigator.clipboard.writeText(newUrl)
        }}
      />
      <ActionButton
        label="open"
        onClick={() => {
          openUrl(newUrl)
        }}
      />
    </Box>
  </Box>
)

const ShareLinkRow = (
  { link, onRevoke }: { readonly link: ShareLinkInfo; readonly onRevoke: (token: string) => void }
): JSX.Element => (
  <Box alignItems="center" flexWrap="wrap" gap={1} justifyContent="space-between">
    <Text fg="#a8c0dc" wrap="truncate">{link.token}</Text>
    <Text fg="#8fa6c4">exp {new Date(link.expiresAt).toLocaleDateString()}</Text>
    <ActionButton
      fg="#ff8aa0"
      label="revoke"
      onClick={() => {
        onRevoke(link.token)
      }}
    />
  </Box>
)

const ContainerShareLinksSection = (
  { projectKey }: { readonly projectKey: string }
): JSX.Element => {
  const [state, setState] = useState<ShareLinksState>({ _tag: "Idle" })
  const idRef = useRef(0)
  const refresh = useCallback(() => {
    runRefreshLinks(projectKey, ++idRef.current, idRef, setState)
  }, [projectKey])
  const generate = useCallback(() => {
    runGenerateLink(projectKey, ++idRef.current, idRef, setState)
  }, [projectKey])
  const revoke = useCallback((token: string) => {
    runRevokeLink(projectKey, token, ++idRef.current, idRef, setState)
  }, [projectKey])
  useEffect(() => {
    refresh()
  }, [refresh])
  return (
    <Box border={true} borderColor="#3a4652" flexDirection="column" gap={1} marginTop={2} padding={1}>
      <Box alignItems="center" flexWrap="wrap" gap={1} justifyContent="space-between">
        <Text bold={true} fg="#8be9fd">Container share links</Text>
        <Box flexWrap="wrap" gap={1}>
          <ActionButton label="generate" onClick={generate} />
          <ActionButton fg="#7fdfff" label="refresh" onClick={refresh} />
        </Box>
      </Box>
      <Text fg="#ffd166" wrap="wrap">Share links give time-limited SSH and terminal access to this container.</Text>
      {state._tag === "Loading" && <Text fg="#8fa6c4">Loading…</Text>}
      {state._tag === "Error" && <Text fg="#ff8aa0" wrap="wrap">{state.message}</Text>}
      {state._tag === "Loaded" && state.newUrl !== null && <ShareLinkNewBanner newUrl={state.newUrl} />}
      {state._tag === "Loaded" && state.links.length === 0 && <Text fg="#8fa6c4">No active share links.</Text>}
      {state._tag === "Loaded" &&
        state.links.map((link) => <ShareLinkRow key={link.token} link={link} onRevoke={revoke} />)}
    </Box>
  )
}

export const SharePanel = (
  {
    onCopyPublicUrl,
    onRefresh,
    onStart,
    onStop,
    selectedProjectKey,
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
      <TunnelLogs lines={tunnel === null ? [] : tunnel.logTail} />
      {selectedProjectKey !== null && <ContainerShareLinksSection projectKey={selectedProjectKey} />}
    </Box>
  )
}
