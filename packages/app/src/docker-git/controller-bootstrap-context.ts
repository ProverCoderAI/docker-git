import { Effect } from "effect"

import { shouldBuildControllerImage } from "./controller-bootstrap-plan.js"
import * as ControllerDocker from "./controller-docker.js"
import { findReachableApiBaseUrl } from "./controller-health.js"
import { inspectControllerImageRevision } from "./controller-image-revision.js"
import {
  buildApiBaseUrlCandidates,
  type DockerNetworkIps,
  resolveApiPort,
  resolveConfiguredApiBaseUrl,
  resolveDefaultLocalApiBaseUrl,
  resolveExplicitApiBaseUrl
} from "./controller-reachability.js"
import {
  prepareControllerResourceLimitEnv,
  shouldForceRecreateForControllerResourceLimits
} from "./controller-resource-limits-shell.js"
import { shouldForceRecreateController } from "./controller-revision.js"
import { prepareControllerRuntimeEnv } from "./controller-runtime-shell.js"
import type { ControllerBootstrapError } from "./host-errors.js"

type ControllerEffect<A> = Effect.Effect<A, ControllerBootstrapError, ControllerDocker.ControllerRuntime>

export type ControllerBootstrapContext = {
  readonly explicitApiBaseUrl: string | undefined
  readonly localControllerRevision: string
  readonly currentControllerRevision: string | null
  readonly currentImageRevision: string | null
  readonly isControllerRunning: boolean
  readonly buildController: boolean
  readonly forceRecreateController: boolean
  readonly currentContainerNetworks: DockerNetworkIps
  readonly initialControllerNetworks: DockerNetworkIps
}

type BuildBootstrapCandidateUrlsInput = {
  readonly explicitApiBaseUrl: string | undefined
  readonly cachedApiBaseUrl: string | undefined
  readonly currentContainerNetworks: DockerNetworkIps
  readonly controllerNetworks: DockerNetworkIps
}

const findReachableApiBaseUrlOrNull = (
  candidateUrls: ReadonlyArray<string>,
  expectedRevision: string | undefined
): Effect.Effect<string | null> =>
  findReachableApiBaseUrl(candidateUrls, expectedRevision).pipe(
    Effect.match({
      onFailure: () => null,
      onSuccess: (apiBaseUrl) => apiBaseUrl
    })
  )

export const loadControllerBootstrapContext = (): ControllerEffect<ControllerBootstrapContext> =>
  Effect.gen(function*(_) {
    yield* _(prepareControllerRuntimeEnv())
    yield* _(prepareControllerResourceLimitEnv())
    const explicitApiBaseUrl = resolveExplicitApiBaseUrl()
    const localControllerRevision = yield* _(ControllerDocker.prepareLocalControllerRevision())
    const isCurrentControllerExists = yield* _(ControllerDocker.controllerExists())
    const isControllerRunning = isCurrentControllerExists
      ? yield* _(ControllerDocker.inspectControllerRunning())
      : false
    const currentControllerRevision = yield* _(ControllerDocker.inspectControllerRevision())
    const currentImageRevision = yield* _(inspectControllerImageRevision())
    const currentContainerNetworks = yield* _(ControllerDocker.resolveCurrentContainerNetworks())
    const initialControllerNetworks = yield* _(
      ControllerDocker.inspectContainerNetworks(ControllerDocker.controllerContainerName)
    )
    const isForceRecreateForResourceLimits = shouldForceRecreateForControllerResourceLimits()
    const isForceRecreateController = isForceRecreateForResourceLimits ||
      shouldForceRecreateController(isCurrentControllerExists, localControllerRevision, currentControllerRevision)

    return {
      explicitApiBaseUrl,
      localControllerRevision,
      currentControllerRevision,
      currentImageRevision,
      isControllerRunning,
      buildController: shouldBuildControllerImage({
        currentControllerRevision,
        currentImageRevision,
        forceRecreateController: isForceRecreateController,
        localControllerRevision
      }),
      forceRecreateController: isForceRecreateController,
      currentContainerNetworks,
      initialControllerNetworks
    }
  })

export const buildBootstrapCandidateUrls = ({
  cachedApiBaseUrl,
  controllerNetworks,
  currentContainerNetworks,
  explicitApiBaseUrl
}: BuildBootstrapCandidateUrlsInput): ReadonlyArray<string> =>
  buildApiBaseUrlCandidates({
    explicitApiBaseUrl,
    defaultLocalApiBaseUrl: resolveDefaultLocalApiBaseUrl(),
    cachedApiBaseUrl,
    defaultApiBaseUrl: resolveConfiguredApiBaseUrl(),
    currentContainerNetworks,
    controllerNetworks,
    port: resolveApiPort()
  })

export const upgradeContextForRuntimeDrift = (
  context: ControllerBootstrapContext,
  cachedApiBaseUrl: string | undefined
): ControllerEffect<ControllerBootstrapContext> =>
  Effect.gen(function*(_) {
    if (
      context.explicitApiBaseUrl !== undefined ||
      context.forceRecreateController ||
      !context.isControllerRunning ||
      context.currentControllerRevision !== context.localControllerRevision
    ) {
      return context
    }

    const reachableApiBaseUrl = yield* _(
      findReachableApiBaseUrlOrNull(
        buildBootstrapCandidateUrls({
          explicitApiBaseUrl: context.explicitApiBaseUrl,
          cachedApiBaseUrl,
          currentContainerNetworks: context.currentContainerNetworks,
          controllerNetworks: context.initialControllerNetworks
        }),
        context.localControllerRevision
      )
    )

    if (reachableApiBaseUrl !== null) {
      return context
    }

    yield* _(
      Effect.logWarning(
        [
          "Detected docker-git controller runtime drift.",
          `Running container ${ControllerDocker.controllerContainerName} exposes inspect revision ${context.currentControllerRevision}`,
          `but no reachable endpoint answered revision ${context.localControllerRevision}.`,
          "Forcing container recreation to discard stale writable-layer startup state."
        ].join(" ")
      )
    )

    const isForceRecreateController = true
    return {
      ...context,
      buildController: shouldBuildControllerImage({
        currentControllerRevision: context.currentControllerRevision,
        currentImageRevision: context.currentImageRevision,
        forceRecreateController: isForceRecreateController,
        localControllerRevision: context.localControllerRevision
      }),
      forceRecreateController: isForceRecreateController
    }
  })
