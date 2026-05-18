import { Effect } from "effect"

import { type BrowserActionContext, withBusy } from "./actions-shared.js"
import type { PanelCloudflareTunnelSession } from "./api.js"
import {
  loadPanelCloudflareTunnel,
  startPanelCloudflareTunnel as startPanelCloudflareTunnelRequest,
  stopPanelCloudflareTunnel as stopPanelCloudflareTunnelRequest
} from "./api.js"

const tryCloudflareSuffix = ".trycloudflare.com"

const currentPanelUrl = (): string => `${globalThis.location.origin}/`

const isTryCloudflareOrigin = (panelUrl: string): boolean => {
  const url = new URL(panelUrl)
  return url.hostname.toLowerCase().endsWith(tryCloudflareSuffix)
}

const tunnelLabel = (tunnel: PanelCloudflareTunnelSession | null): string =>
  tunnel?.publicUrl ?? tunnel?.status ?? "not running"

export const refreshPanelCloudflareTunnel = (
  context: BrowserActionContext,
  options?: { readonly silent?: boolean }
) => {
  withBusy({
    context,
    effect: loadPanelCloudflareTunnel(),
    label: "Loading share tunnel",
    onSuccess: (tunnel) => {
      context.setPanelCloudflareTunnel(tunnel)
      if (options?.silent !== true) {
        context.setMessage(`Share tunnel: ${tunnelLabel(tunnel)}.`)
      }
    }
  })
}

export const startPanelShareTunnel = (context: BrowserActionContext) => {
  const panelUrl = currentPanelUrl()
  if (isTryCloudflareOrigin(panelUrl)) {
    context.setMessage("Open docker-git locally before starting a new Cloudflare tunnel.")
    return
  }

  withBusy({
    context,
    effect: startPanelCloudflareTunnelRequest(panelUrl).pipe(
      Effect.flatMap((tunnel) =>
        tunnel === null ? Effect.fail("Cloudflare tunnel did not return a session.") : Effect.succeed(tunnel)
      )
    ),
    label: "Starting share tunnel",
    onSuccess: (tunnel) => {
      context.setPanelCloudflareTunnel(tunnel)
      context.setMessage(
        tunnel.publicUrl === null
          ? "Cloudflare tunnel is starting. Refresh in a few seconds."
          : `Panel is shared at ${tunnel.publicUrl}.`
      )
    }
  })
}

export const stopPanelShareTunnel = (context: BrowserActionContext) => {
  withBusy({
    context,
    effect: stopPanelCloudflareTunnelRequest(),
    label: "Stopping share tunnel",
    onSuccess: (tunnel) => {
      context.setPanelCloudflareTunnel(tunnel)
      context.setMessage("Cloudflare tunnel stopped.")
    }
  })
}

export const copyPanelShareTunnelUrl = (
  context: BrowserActionContext,
  publicUrl: string
) => {
  withBusy({
    context,
    effect: Effect.tryPromise({
      try: () => globalThis.navigator.clipboard.writeText(publicUrl),
      catch: () => "Failed to copy tunnel URL."
    }),
    label: "Copying tunnel URL",
    onSuccess: () => {
      context.setMessage("Tunnel URL copied.")
    }
  })
}
