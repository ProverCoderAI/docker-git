/* jscpd:ignore-start */
import { FetchHttpClient, HttpClient } from "@effect/platform"
import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import { Effect, Either } from "effect"

import { parseGithubOauthScopesHeader } from "./github-scope-policy.js"

const githubTokenValidationUrl = "https://api.github.com/user"

export const githubTokenValidationWarning = "Unable to validate GitHub token before start; continuing."
export const githubInvalidTokenMessage = [
  "GitHub auth is invalid: the stored token is dead, revoked, expired, or malformed.",
  "To restore access, run: docker-git auth github login --web"
].join("\n")

type GithubUser = {
  readonly login: string
}

export type GithubTokenValidationStatus = "valid" | "invalid" | "unknown"

export type GithubTokenValidationResult = {
  readonly status: GithubTokenValidationStatus
  readonly login: string | null
  readonly oauthScopes: ReadonlyArray<string> | null
}

const GithubUserSchema: Schema.Schema<GithubUser> = Schema.Struct({
  login: Schema.String
})
const GithubUserJsonSchema = Schema.parseJson(GithubUserSchema)

const unknownGithubTokenValidationResult = (): GithubTokenValidationResult => ({
  status: "unknown",
  login: null,
  oauthScopes: null
})

const decodeGithubUserLogin = (input: string): string | null =>
  Either.match(ParseResult.decodeUnknownEither(GithubUserJsonSchema)(input), {
    onLeft: () => null,
    onRight: (user) => user.login
  })

const mapGithubTokenValidationStatus = (status: number): GithubTokenValidationStatus => {
  if (status === 401) {
    return "invalid"
  }
  return status >= 200 && status < 300 ? "valid" : "unknown"
}

// CHANGE: validate GitHub token and decode the authenticated account login/scopes on success
// WHY: auth status, create preflight, and auth persistence must share one live GitHub validation boundary
// QUOTE(ТЗ): "status проверял валидность токена и если он валидный то писал бы кто овнер"
// REF: user-request-2026-03-19-github-token-status-owner
// SOURCE: n/a
// FORMAT THEOREM: ∀t: probe(t).status = valid → probe(t).login ∈ String ∪ null
// PURITY: SHELL
// EFFECT: Effect<GithubTokenValidationResult, never, never>
// INVARIANT: token is never logged; unknown/transport failures degrade to `unknown`
// COMPLEXITY: O(1) network round-trip
export const validateGithubToken = (token: string): Effect.Effect<GithubTokenValidationResult> =>
  Effect.gen(function*(_) {
    const client = yield* _(HttpClient.HttpClient)
    const response = yield* _(
      client.get(githubTokenValidationUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json"
        }
      })
    )

    const status = mapGithubTokenValidationStatus(response.status)
    const oauthScopes = parseGithubOauthScopesHeader(response.headers["x-oauth-scopes"])
    if (status !== "valid") {
      return {
        status,
        login: null,
        oauthScopes
      } satisfies GithubTokenValidationResult
    }

    const body = yield* _(response.text)
    return {
      status,
      login: decodeGithubUserLogin(body),
      oauthScopes
    } satisfies GithubTokenValidationResult
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.match({
      onFailure: unknownGithubTokenValidationResult,
      onSuccess: (result) => result
    })
  )
/* jscpd:ignore-end */
