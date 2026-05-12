import type { HttpClient } from "@effect/platform"
import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import { Either } from "effect"

type GitlabUser = {
  readonly username: string
}

const GitlabUserSchema: Schema.Schema<GitlabUser> = Schema.Struct({
  username: Schema.String
})
const GitlabUserJsonSchema = Schema.parseJson(GitlabUserSchema)

export const gitlabPrivateTokenHeaders = (token: string): Record<string, string> => ({
  "PRIVATE-TOKEN": token
})

export const gitlabBearerTokenHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`
})

export const getGitlabApi = (
  client: HttpClient.HttpClient,
  url: string,
  headers: Record<string, string>
) =>
  client.get(url, {
    headers: {
      ...headers,
      Accept: "application/json"
    }
  })

export const decodeGitlabUsername = (input: string): string | null =>
  Either.match(ParseResult.decodeUnknownEither(GitlabUserJsonSchema)(input), {
    onLeft: () => null,
    onRight: (user) => user.username
  })
