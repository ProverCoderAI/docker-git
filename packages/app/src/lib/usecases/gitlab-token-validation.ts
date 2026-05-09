import { FetchHttpClient, HttpClient } from "@effect/platform"
import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import { Effect, Either } from "effect"

const gitlabTokenValidationUrl = "https://gitlab.com/api/v4/user"

export const gitlabTokenValidationWarning = "Unable to validate GitLab token before start; continuing."
export const gitlabInvalidTokenMessage = [
  "GitLab auth is invalid: the stored token is dead, revoked, expired, or malformed.",
  "To restore access, run: docker-git auth gitlab login"
].join("\n")

type GitlabUser = {
  readonly username: string
}

export type GitlabTokenValidationStatus = "valid" | "invalid" | "unknown"

export type GitlabTokenValidationResult = {
  readonly status: GitlabTokenValidationStatus
  readonly login: string | null
}

const GitlabUserSchema: Schema.Schema<GitlabUser> = Schema.Struct({
  username: Schema.String
})
const GitlabUserJsonSchema = Schema.parseJson(GitlabUserSchema)

const unknownGitlabTokenValidationResult = (): GitlabTokenValidationResult => ({
  status: "unknown",
  login: null
})

const decodeGitlabUsername = (input: string): string | null =>
  Either.match(ParseResult.decodeUnknownEither(GitlabUserJsonSchema)(input), {
    onLeft: () => null,
    onRight: (user) => user.username
  })

const mapGitlabTokenValidationStatus = (status: number): GitlabTokenValidationStatus => {
  if (status === 401 || status === 403) {
    return "invalid"
  }
  return status >= 200 && status < 300 ? "valid" : "unknown"
}

const requestGitlabUser = (
  client: HttpClient.HttpClient,
  headers: Record<string, string>
) =>
  Effect.gen(function*(_) {
    const response = yield* _(
      client.get(gitlabTokenValidationUrl, {
        headers: {
          ...headers,
          Accept: "application/json"
        }
      })
    )

    const status = mapGitlabTokenValidationStatus(response.status)
    if (status !== "valid") {
      return {
        status,
        login: null
      } satisfies GitlabTokenValidationResult
    }

    const body = yield* _(response.text)
    return {
      status,
      login: decodeGitlabUsername(body)
    } satisfies GitlabTokenValidationResult
  })

// CHANGE: validate GitLab token and decode the authenticated account username
// WHY: GitLab auth status and clone preflight must share one live validation boundary
// REF: issue-252
// SOURCE: https://docs.gitlab.com/api/users/#get-the-current-user
// PURITY: SHELL
export const validateGitlabToken = (token: string): Effect.Effect<GitlabTokenValidationResult> =>
  Effect.gen(function*(_) {
    const client = yield* _(HttpClient.HttpClient)
    const privateTokenResult = yield* _(requestGitlabUser(client, { "PRIVATE-TOKEN": token }))
    if (privateTokenResult.status !== "invalid") {
      return privateTokenResult
    }
    return yield* _(requestGitlabUser(client, { Authorization: `Bearer ${token}` }))
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.match({
      onFailure: unknownGitlabTokenValidationResult,
      onSuccess: (result) => result
    })
  )
