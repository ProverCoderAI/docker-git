import { FetchHttpClient, HttpClient } from "@effect/platform"
import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import { Effect, Either } from "effect"

import { buildApiBaseUrlCandidates, resolveApiPort, resolveConfiguredApiBaseUrl } from "./controller-reachability.js"
import type { ControllerBootstrapError } from "./host-errors.js"

type HealthProbeResult = {
  readonly apiBaseUrl: string
  readonly revision: string | null
}

const HealthProbeBodySchema = Schema.Struct({
  revision: Schema.optional(Schema.String)
})

const HealthProbeBodyFromStringSchema = Schema.parseJson(HealthProbeBodySchema)

const controllerBootstrapError = (message: string): ControllerBootstrapError => ({
  _tag: "ControllerBootstrapError",
  message
})

const parseHealthRevision = (text: string): string | null =>
  Either.match(ParseResult.decodeUnknownEither(HealthProbeBodyFromStringSchema)(text), {
    onLeft: () => null,
    onRight: (body) => {
      const revision = body.revision
      return revision !== undefined && revision.trim().length > 0 ? revision.trim() : null
    }
  })

const probeHealth = (apiBaseUrl: string): Effect.Effect<HealthProbeResult, ControllerBootstrapError> =>
  Effect.gen(function*(_) {
    const client = yield* _(HttpClient.HttpClient)
    const response = yield* _(client.get(`${apiBaseUrl}/health`, { headers: { accept: "application/json" } }))
    const bodyText = yield* _(response.text)

    if (response.status >= 200 && response.status < 300) {
      return {
        apiBaseUrl,
        revision: parseHealthRevision(bodyText)
      }
    }

    return yield* _(
      Effect.fail(
        controllerBootstrapError(
          `docker-git controller health returned ${response.status} at ${apiBaseUrl}/health`
        )
      )
    )
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.mapError((error): ControllerBootstrapError =>
      error._tag === "ControllerBootstrapError"
        ? error
        : {
          _tag: "ControllerBootstrapError",
          message: `docker-git controller health probe failed at ${apiBaseUrl}/health\nDetails: ${String(error)}`
        }
    )
  )

const findReachableHealthProbe = (
  candidateUrls: ReadonlyArray<string>,
  expectedRevision?: string
): Effect.Effect<HealthProbeResult, ControllerBootstrapError> =>
  Effect.gen(function*(_) {
    if (candidateUrls.length === 0) {
      return yield* _(
        Effect.fail(controllerBootstrapError("No docker-git controller endpoint candidates were generated."))
      )
    }

    const mismatches: Array<string> = []
    for (const candidateUrl of candidateUrls) {
      const healthy = yield* _(probeHealth(candidateUrl).pipe(Effect.either))
      if (Either.isLeft(healthy)) {
        continue
      }
      if (matchesExpectedRevision(healthy.right, expectedRevision)) {
        return healthy.right
      }
      mismatches.push(describeRevisionMismatch(healthy.right))
    }

    return yield* _(Effect.fail(noMatchingHealthProbeError(expectedRevision, mismatches)))
  })

const findReachableHealthProbeOrNull = (
  candidateUrls: ReadonlyArray<string>
): Effect.Effect<HealthProbeResult | null> =>
  findReachableHealthProbe(candidateUrls).pipe(
    Effect.match({
      onFailure: () => null,
      onSuccess: (probe) => probe
    })
  )

const matchesExpectedRevision = (
  probe: HealthProbeResult,
  expectedRevision: string | undefined
): boolean => expectedRevision === undefined || probe.revision === expectedRevision

const describeRevisionMismatch = (probe: HealthProbeResult): string =>
  `${probe.apiBaseUrl} revision ${probe.revision ?? "unknown"}`

const noMatchingHealthProbeError = (
  expectedRevision: string | undefined,
  mismatches: ReadonlyArray<string>
): ControllerBootstrapError =>
  expectedRevision !== undefined && mismatches.length > 0
    ? controllerBootstrapError(
      `No docker-git controller endpoint with revision ${expectedRevision} responded. ` +
        `Reachable mismatched controllers: ${mismatches.join(", ")}.`
    )
    : controllerBootstrapError("No docker-git controller endpoint responded to /health.")

export const findReachableApiBaseUrl = (
  candidateUrls: ReadonlyArray<string>,
  expectedRevision?: string
): Effect.Effect<string, ControllerBootstrapError> =>
  findReachableHealthProbe(candidateUrls, expectedRevision).pipe(Effect.map(({ apiBaseUrl }) => apiBaseUrl))

// CHANGE: select only controller endpoints that prove the expected source revision.
// WHY: containerized hosts can see stale controllers through host.docker.internal before the current local controller is reachable.
// QUOTE(ТЗ): "проверь сам что Open Browser кнопка работает"
// REF: user-message-2026-05-29-open-browser-e2e
// SOURCE: n/a
// FORMAT THEOREM: selected(endpoint) -> health(endpoint).revision = expectedRevision
// PURITY: SHELL
// EFFECT: FetchHttpClient health probes.
// INVARIANT: mismatched reachable controllers are rejected rather than reused.
// COMPLEXITY: O(n) health probes where n = |candidateUrls|.
export const findReachableApiBaseUrlMatchingRevision = (
  candidateUrls: ReadonlyArray<string>,
  expectedRevision: string
): Effect.Effect<string, ControllerBootstrapError> => findReachableApiBaseUrl(candidateUrls, expectedRevision)

export const findReachableDirectHealthProbe = (options: {
  readonly explicitApiBaseUrl: string | undefined
  readonly defaultLocalApiBaseUrl: string | undefined
  readonly cachedApiBaseUrl: string | undefined
}): Effect.Effect<HealthProbeResult | null> =>
  findReachableHealthProbeOrNull(
    buildApiBaseUrlCandidates({
      explicitApiBaseUrl: options.explicitApiBaseUrl,
      defaultLocalApiBaseUrl: options.defaultLocalApiBaseUrl,
      cachedApiBaseUrl: options.cachedApiBaseUrl,
      defaultApiBaseUrl: resolveConfiguredApiBaseUrl(),
      currentContainerNetworks: {},
      controllerNetworks: {},
      port: resolveApiPort()
    })
  )
