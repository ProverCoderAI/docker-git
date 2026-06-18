import { makeDockerGitOpenApiRuntime } from "@prover-coder-ai/docker-git-openapi"

import { resolveApiBaseUrl } from "./api-http.js"

const openApiRuntime = makeDockerGitOpenApiRuntime({
  resolveBaseUrl: resolveApiBaseUrl
})

/**
 * Executes a docker-git OpenAPI JSON request against the current browser API base URL.
 *
 * @pure false - performs HTTP IO when the returned Effect is run.
 * @effect openapi-fetch request wrapped in Effect.
 * @invariant the shared OpenAPI runtime owns transport decoding and error rendering.
 * @precondition request uses generated docker-git OpenAPI paths.
 * @postcondition success contains the endpoint data branch as a JSON transport value.
 * @complexity O(n)/O(n) for error rendering, O(1)/O(1) on local success handling.
 * @throws Never; failures are returned in the Effect error channel.
 */
export const openApiJson = openApiRuntime.openApiJson

/**
 * Executes a docker-git OpenAPI request and decodes the response with an Effect Schema.
 *
 * @pure false - performs HTTP IO and boundary decoding when the returned Effect is run.
 * @effect openapi-fetch request plus synchronous Schema decoding.
 * @invariant generated transport shapes are decoded before leaving the web API boundary.
 * @precondition schema matches the endpoint success response contract.
 * @postcondition success contains the schema-decoded DTO expected by UI code.
 * @complexity O(n)/O(n) where n is the decoded response size.
 * @throws Never; failures are returned in the Effect error channel.
 */
export const openApiJsonSchema = openApiRuntime.openApiJsonSchema

/**
 * Executes a docker-git OpenAPI request whose success response has no body.
 *
 * @pure false - performs HTTP IO when the returned Effect is run.
 * @effect openapi-fetch request wrapped in Effect.
 * @invariant only the HTTP success status determines the void success branch.
 * @precondition request targets an endpoint whose successful response has no content.
 * @postcondition success returns void without exposing transport details.
 * @complexity O(n)/O(n) for error rendering, O(1)/O(1) on local success handling.
 * @throws Never; failures are returned in the Effect error channel.
 */
export const openApiVoid = openApiRuntime.openApiVoid
