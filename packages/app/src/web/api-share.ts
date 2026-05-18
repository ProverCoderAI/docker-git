import { Effect } from "effect"

import { requestJson } from "./api-http.js"
import { PanelCloudflareTunnelResponseSchema } from "./api-schema.js"

export const loadPanelCloudflareTunnel = () =>
  requestJson("GET", "/cloudflare-tunnels/panel", PanelCloudflareTunnelResponseSchema).pipe(
    Effect.map((response) => response.tunnel)
  )

export const startPanelCloudflareTunnel = (panelUrl: string) =>
  requestJson(
    "POST",
    "/cloudflare-tunnels/panel",
    PanelCloudflareTunnelResponseSchema,
    { panelUrl }
  ).pipe(
    Effect.map((response) => response.tunnel)
  )

export const stopPanelCloudflareTunnel = () =>
  requestJson("DELETE", "/cloudflare-tunnels/panel", PanelCloudflareTunnelResponseSchema).pipe(
    Effect.map((response) => response.tunnel)
  )
