import { Effect } from "effect"

import * as ControllerDocker from "./controller-docker.js"
import { type DockerNetworkIps, formatNetworkIps } from "./controller-reachability.js"

// CHANGE: document controller reachability diagnostics as a SHELL effect.
// WHY: diagnostics inspect published controller ports and must make their runtime dependency explicit.
// QUOTE(ТЗ): n/a
// REF: PR-360-coderabbit-reachability-diagnostics-contract
// SOURCE: n/a
// FORMAT THEOREM: forall candidates C: diagnostics(C) returns a string containing attempted endpoints and runtime network state.
// PURITY: SHELL
// EFFECT: Effect<string, never, ControllerDocker.ControllerRuntime>
// INVARIANT: every returned diagnostic string includes candidate URLs, published ports, current runtime networks, and controller networks.
// COMPLEXITY: O(n) where n = |candidateUrls|.
/**
 * Collects host/controller reachability diagnostics for failed bootstrap probes.
 *
 * @param candidateUrls - API base URL candidates attempted by the bootstrap path.
 * @param currentContainerNetworks - network IPs visible from the current runtime container.
 * @param controllerNetworks - network IPs attached to the docker-git controller container.
 * @returns Effect.Effect<string, never, ControllerDocker.ControllerRuntime>
 *
 * @pure false
 * @effect Requires ControllerDocker.inspectControllerPublishedPorts through ControllerDocker.ControllerRuntime.
 * @invariant The result describes controller runtime endpoints, published ports, and network visibility.
 * @complexity O(n) where n is candidateUrls.length.
 */
export const collectReachabilityDiagnostics = (
  candidateUrls: ReadonlyArray<string>,
  currentContainerNetworks: DockerNetworkIps,
  controllerNetworks: DockerNetworkIps
): Effect.Effect<string, never, ControllerDocker.ControllerRuntime> =>
  Effect.gen(function*(_) {
    const publishedPorts = yield* _(ControllerDocker.inspectControllerPublishedPorts())

    return [
      "Tried endpoints:",
      ...candidateUrls.map((candidateUrl) => `- ${candidateUrl}`),
      `Published ports: ${publishedPorts.length > 0 ? publishedPorts : "unavailable"}`,
      `Current runtime networks: ${formatNetworkIps(currentContainerNetworks)}`,
      `Controller networks: ${formatNetworkIps(controllerNetworks)}`
    ].join("\n")
  })
