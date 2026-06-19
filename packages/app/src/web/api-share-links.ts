import { Effect } from "effect"
import * as Schema from "@effect/schema/Schema"

import { requestJson } from "./api-http.js"

const ShareLinkInfoSchema = Schema.Struct({
  token: Schema.String,
  projectKey: Schema.String,
  projectDir: Schema.String,
  displayName: Schema.String,
  sshAlias: Schema.String,
  sshConfigSnippet: Schema.String,
  cfSshConfigSnippet: Schema.NullOr(Schema.String),
  vscodeUri: Schema.String,
  cfVscodeUri: Schema.NullOr(Schema.String),
  workspacePath: Schema.String,
  createdAt: Schema.String,
  expiresAt: Schema.String
})

export type ShareLinkInfo = Schema.Schema.Type<typeof ShareLinkInfoSchema>

const ShareLinkResponseSchema = Schema.Struct({ link: ShareLinkInfoSchema })
const CreateShareLinkResponseSchema = Schema.Struct({
  ok: Schema.Literal(true),
  link: ShareLinkInfoSchema,
  url: Schema.String
})
const ShareLinksListResponseSchema = Schema.Struct({
  links: Schema.Array(ShareLinkInfoSchema)
})
const OkResponseSchema = Schema.Struct({ ok: Schema.Literal(true) })

export const loadShareLink = (
  token: string,
  clientHost: string
): Effect.Effect<ShareLinkInfo, string> =>
  requestJson(
    "GET",
    `/share-links/${encodeURIComponent(token)}?host=${encodeURIComponent(clientHost)}`,
    ShareLinkResponseSchema
  ).pipe(Effect.map((r) => r.link))

export const createProjectShareLink = (
  projectKey: string,
  ttlMs?: number
): Effect.Effect<{ readonly link: ShareLinkInfo; readonly url: string }, string> =>
  requestJson(
    "POST",
    `/projects/by-key/${encodeURIComponent(projectKey)}/share-links`,
    CreateShareLinkResponseSchema,
    ttlMs !== undefined ? { ttlMs } : {}
  ).pipe(Effect.map(({ link, url }) => ({ link, url })))

export const listProjectShareLinks = (
  projectKey: string
): Effect.Effect<ReadonlyArray<ShareLinkInfo>, string> =>
  requestJson(
    "GET",
    `/projects/by-key/${encodeURIComponent(projectKey)}/share-links`,
    ShareLinksListResponseSchema
  ).pipe(Effect.map((r) => r.links))

export const deleteProjectShareLink = (
  projectKey: string,
  token: string
): Effect.Effect<void, string> =>
  requestJson(
    "DELETE",
    `/projects/by-key/${encodeURIComponent(projectKey)}/share-links/${encodeURIComponent(token)}`,
    OkResponseSchema
  ).pipe(Effect.asVoid)
