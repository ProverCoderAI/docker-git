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
  candidateUrls: ReadonlyArray<string>
): Effect.Effect<HealthProbeResult, ControllerBootstrapError> =>
  Effect.gen(function*(_) {
    if (candidateUrls.length === 0) {
      return yield* _(
        Effect.fail(controllerBootstrapError("No docker-git controller endpoint candidates were generated."))
      )
    }

    for (const candidateUrl of candidateUrls) {
      const healthy = yield* _(probeHealth(candidateUrl).pipe(Effect.either))
      if (Either.isRight(healthy)) {
        return healthy.right
      }
    }

    return yield* _(Effect.fail(controllerBootstrapError("No docker-git controller endpoint responded to /health.")))
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

export const findReachableApiBaseUrl = (
  candidateUrls: ReadonlyArray<string>
): Effect.Effect<string, ControllerBootstrapError> =>
  findReachableHealthProbe(candidateUrls).pipe(Effect.map(({ apiBaseUrl }) => apiBaseUrl))

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
