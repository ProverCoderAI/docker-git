import { Effect } from "effect"

import { PanelCloudflareTunnelResponseSchema } from "./api-schema.js"
import { openApiJsonSchema } from "./openapi-client.js"

/**
 * Reads the controller-owned panel Cloudflare tunnel session.
 *
 * @pure false
 * @effect Network GET /cloudflare-tunnels/panel through requestJson.
 * @invariant The response is decoded by PanelCloudflareTunnelResponseSchema before exposing tunnel state.
 * @precondition The docker-git API base URL resolves from the current web runtime.
 * @postcondition The returned Effect succeeds with the current tunnel session or null.
 * @complexity O(1) local work plus network IO.
 * @throws Never; failures are represented in the Effect error channel.
 */
// CHANGE: Load the current panel Cloudflare tunnel session for Share UI.
// WHY: Share UI needs a single decoded read path for controller-owned tunnel state.
// QUOTE(TZ): "out-of-the-box Cloudflare tunnel" sharing.
// REF: issue-310
// SOURCE: n/a
// FORMAT THEOREM: forall decoded responses r, load(r) = r.tunnel.
// PURITY: SHELL
// EFFECT: Effect<PanelCloudflareTunnelSession | null, string, never>
// INVARIANT: Only schema-decoded tunnel state crosses the API boundary.
// COMPLEXITY: O(1) local work plus network IO.
export const loadPanelCloudflareTunnel = () =>
  openApiJsonSchema(PanelCloudflareTunnelResponseSchema, (client) => client.GET("/cloudflare-tunnels/panel")).pipe(
    Effect.map((response) => response.tunnel)
  )

/**
 * Requests a panel Cloudflare tunnel for the supplied panel origin.
 *
 * @pure false
 * @effect Network POST /cloudflare-tunnels/panel through requestJson.
 * @invariant The response is decoded by PanelCloudflareTunnelResponseSchema before exposing tunnel state.
 * @precondition panelUrl is the current local panel origin string.
 * @postcondition The returned Effect succeeds with the started or starting tunnel session.
 * @complexity O(1) local work plus network IO and controller-side cloudflared startup.
 * @throws Never; failures are represented in the Effect error channel.
 */
// CHANGE: Start or reuse the controller-owned panel Cloudflare tunnel.
// WHY: Share UI must not start arbitrary per-project or per-port tunnels.
// QUOTE(TZ): "out-of-the-box Cloudflare tunnel" sharing.
// REF: issue-310
// SOURCE: n/a
// FORMAT THEOREM: forall panel origins p, start(p) returns the controller session for p.
// PURITY: SHELL
// EFFECT: Effect<PanelCloudflareTunnelSession | null, string, never>
// INVARIANT: Returned state is decoded by PanelCloudflareTunnelResponseSchema.
// COMPLEXITY: O(1) local work plus network IO and controller-side startup.
export const startPanelCloudflareTunnel = (panelUrl: string) =>
  openApiJsonSchema(PanelCloudflareTunnelResponseSchema, (client) =>
    client.POST("/cloudflare-tunnels/panel", {
      body: { panelUrl }
    })).pipe(
      Effect.map((response) => response.tunnel)
    )

/**
 * Stops the controller-owned panel Cloudflare tunnel.
 *
 * @pure false
 * @effect Network DELETE /cloudflare-tunnels/panel through requestJson.
 * @invariant The response is decoded by PanelCloudflareTunnelResponseSchema before exposing tunnel state.
 * @precondition The docker-git API base URL resolves from the current web runtime.
 * @postcondition The returned Effect succeeds with the stopped tunnel session or null.
 * @complexity O(1) local work plus network IO and controller-side process cleanup.
 * @throws Never; failures are represented in the Effect error channel.
 */
// CHANGE: Stop the controller-owned panel Cloudflare tunnel.
// WHY: Share UI needs an explicit lifecycle endpoint for cloudflared cleanup.
// QUOTE(TZ): "out-of-the-box Cloudflare tunnel" sharing.
// REF: issue-310
// SOURCE: n/a
// FORMAT THEOREM: forall sessions s, stop(s) yields stopped(s) or null when absent.
// PURITY: SHELL
// EFFECT: Effect<PanelCloudflareTunnelSession | null, string, never>
// INVARIANT: Returned state is decoded by PanelCloudflareTunnelResponseSchema.
// COMPLEXITY: O(1) local work plus network IO and controller-side cleanup.
export const stopPanelCloudflareTunnel = () =>
  openApiJsonSchema(PanelCloudflareTunnelResponseSchema, (client) => client.DELETE("/cloudflare-tunnels/panel")).pipe(
    Effect.map((response) => response.tunnel)
  )
