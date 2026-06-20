import { createClientEffect, mergeHeaders } from "@prover-coder-ai/openapi-effect"
import type {
  ClientEffect,
  ClientOptions,
  Middleware
} from "@prover-coder-ai/openapi-effect"

import type { paths } from "./openapi-paths.js"

export type {
  ApiFailure,
  ApiSuccess,
  BoundaryError,
  DecodeError,
  HttpError,
  ParseError,
  TransportError,
  UnexpectedContentType,
  UnexpectedStatus
} from "@prover-coder-ai/openapi-effect"

export type DockerGitOpenApiClient = ClientEffect<paths>

export type DockerGitOpenApiClientOptions = ClientOptions

/**
 * Default JSON no-cache headers for docker-git OpenAPI requests.
 *
 * @pure true - immutable header constant.
 * @effect none.
 * @invariant every configured client request has JSON accept and no-cache directives unless overridden downstream.
 * @precondition none.
 * @postcondition header keys are safe to pass to Fetch Headers.
 * @complexity O(1)/O(1).
 * @throws Never.
 */
export const openApiJsonNoCacheHeaders: Readonly<Record<string, string>> = {
  accept: "application/json",
  "cache-control": "no-cache, no-store, max-age=0",
  pragma: "no-cache"
}

// CHANGE: Keep browser GETs cache-busted while returning the raw openapi-effect client.
// WHY: UI polling must not reuse stale JSON, but response typing belongs to openapi-effect.
// QUOTE(ТЗ): "Зачем нам прослойка? Если client сам возвращает нужную схему рабочую"
// REF: user-openapi-effect-direct-client
// SOURCE: n/a
// FORMAT THEOREM: forall GET request r: url(createClient(r)) contains fresh cache key.
// PURITY: SHELL
// EFFECT: none
// INVARIANT: middleware mutates only GET request URLs, never response values or error channels.
// COMPLEXITY: O(1)/O(1)
const noCacheGetMiddleware: Middleware = {
  onRequest: ({ request }) => {
    if (request.method !== "GET") {
      return
    }
    const url = new URL(request.url)
    url.searchParams.set("_", String(Date.now()))
    return new Request(url, request)
  }
}

const withDockerGitDefaults = (
  options: DockerGitOpenApiClientOptions | undefined
): ClientOptions => ({
  ...options,
  headers: mergeHeaders(openApiJsonNoCacheHeaders, options?.headers)
})

/**
 * Creates the docker-git OpenAPI Effect client.
 *
 * @param options - openapi-effect client options.
 * @returns Typed `ClientEffect<paths>` for the generated docker-git OpenAPI contract.
 *
 * @pure false - constructs a Fetch-backed client and installs request middleware.
 * @effect none during construction; client methods return Effect values for network IO.
 * @invariant returned methods are exactly the openapi-effect methods over generated `paths`.
 * @precondition `options.baseUrl` points at a docker-git API server or compatible proxy.
 * @postcondition GET requests carry a cache-busting query parameter and JSON no-cache headers.
 * @complexity O(1)/O(1), excluding request execution.
 * @throws Never.
 */
export const createClient = (
  options?: DockerGitOpenApiClientOptions
): DockerGitOpenApiClient => {
  const client = createClientEffect<paths>(withDockerGitDefaults(options))
  client.use(noCacheGetMiddleware)
  return client
}
