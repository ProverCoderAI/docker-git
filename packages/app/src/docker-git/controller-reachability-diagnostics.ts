import { Effect } from "effect"

import * as ControllerDocker from "./controller-docker.js"
import { type DockerNetworkIps, formatNetworkIps } from "./controller-reachability.js"

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
