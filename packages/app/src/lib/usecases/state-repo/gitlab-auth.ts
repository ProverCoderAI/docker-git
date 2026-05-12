/* jscpd:ignore-start */
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"
import { parseEnvEntries } from "../env-file.js"
import { gitBaseEnv } from "./git-commands.js"
import type { GitAuthEnv } from "./github-auth.js"

const gitlabTokenKey = "GITLAB_TOKEN"
const gitlabAccessTokenKey = "GITLAB_ACCESS_TOKEN"
const gitAuthTokenKey = "GIT_AUTH_TOKEN"

const gitlabHttpsRemoteRe = /^https:\/\/(?:[^/]+@)?gitlab\.com\/(.+?)(?:\.git)?$/u
const gitlabSshRemoteRe = /^git@gitlab\.com:(.+?)(?:\.git)?$/u
const gitlabSshUrlRemoteRe = /^ssh:\/\/git@gitlab\.com\/(.+?)(?:\.git)?$/u

type GitlabRemoteParts = {
  readonly fullPath: string
}

const trimTrailingSlashes = (value: string): string => {
  let end = value.length
  while (end > 0 && value.slice(end - 1, end) === "/") {
    end -= 1
  }
  return value.slice(0, end)
}

const trimGitSuffix = (value: string): string => value.endsWith(".git") ? value.slice(0, -".git".length) : value

const normalizeGitlabFullPath = (value: string): string => trimGitSuffix(trimTrailingSlashes(value.trim()))

const tryParseGitlabRemoteParts = (originUrl: string): GitlabRemoteParts | null => {
  const trimmed = originUrl.trim()
  const match = gitlabHttpsRemoteRe.exec(trimmed) ??
    gitlabSshRemoteRe.exec(trimmed) ??
    gitlabSshUrlRemoteRe.exec(trimmed)
  if (match === null) {
    return null
  }
  const fullPath = normalizeGitlabFullPath(match[1] ?? "")
  return fullPath.length > 0 ? { fullPath } : null
}

export const tryBuildGitlabCompareUrl = (
  originUrl: string,
  baseBranch: string,
  headBranch: string
): string | null => {
  const parts = tryParseGitlabRemoteParts(originUrl)
  if (parts === null) {
    return null
  }
  return `https://gitlab.com/${parts.fullPath}/-/compare/${encodeURIComponent(baseBranch)}...${
    encodeURIComponent(headBranch)
  }`
}

export const isGitlabHttpsRemote = (url: string): boolean => /^https:\/\/(?:[^/]+@)?gitlab\.com\//u.test(url.trim())

export const normalizeGitlabHttpsRemote = (url: string): string | null => {
  if (!isGitlabHttpsRemote(url)) {
    return null
  }
  const parts = tryParseGitlabRemoteParts(url)
  return parts === null ? null : `https://gitlab.com/${parts.fullPath}.git`
}

const resolveTokenFromProcessEnv = (): string | null => {
  const candidates: ReadonlyArray<string | undefined> = [
    process.env[gitlabTokenKey],
    process.env[gitlabAccessTokenKey],
    process.env[gitAuthTokenKey]
  ]
  const token = candidates.map((value) => value?.trim() ?? "").find((value) => value.length > 0)
  return token ?? null
}

type EnvEntry = {
  readonly key: string
  readonly value: string
}

const findFirstToken = (
  entries: ReadonlyArray<EnvEntry>,
  directKey: string,
  labeledPrefix: string
): string | null => {
  const directEntry = entries.find((e) => e.key === directKey)
  if (directEntry !== undefined) {
    const direct = directEntry.value.trim()
    if (direct.length > 0) {
      return direct
    }
  }

  const labeledEntry = entries.find((e) => e.key.startsWith(labeledPrefix))
  if (labeledEntry !== undefined) {
    const labeled = labeledEntry.value.trim()
    if (labeled.length > 0) {
      return labeled
    }
  }

  return null
}

const findTokenInEnvEntries = (entries: ReadonlyArray<EnvEntry>): string | null =>
  findFirstToken(entries, gitlabTokenKey, "GITLAB_TOKEN__") ??
    findFirstToken(entries, gitlabAccessTokenKey, "GITLAB_ACCESS_TOKEN__") ??
    findFirstToken(entries, gitAuthTokenKey, "GIT_AUTH_TOKEN__")

export const resolveGitlabToken = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string
): Effect.Effect<string | null, PlatformError> =>
  Effect.gen(function*(_) {
    const fromEnv = resolveTokenFromProcessEnv()
    if (fromEnv !== null) {
      return fromEnv
    }

    const candidates: ReadonlyArray<string> = [
      path.join(root, ".orch", "env", "global.env"),
      path.join(root, "secrets", "global.env")
    ]

    for (const envPath of candidates) {
      const exists = yield* _(fs.exists(envPath))
      if (!exists) {
        continue
      }
      const text = yield* _(fs.readFileString(envPath))
      const token = findTokenInEnvEntries(parseEnvEntries(text))
      if (token !== null) {
        return token
      }
    }

    return null
  })

export const withGitlabAskpassEnv = <A, E, R>(
  token: string,
  use: (env: GitAuthEnv) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | PlatformError, FileSystem.FileSystem | R> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const askpassPath = yield* _(fs.makeTempFileScoped({ prefix: "docker-git-gitlab-askpass-" }))
      const contents = [
        "#!/bin/sh",
        "case \"$1\" in",
        "  *Username*) echo \"oauth2\" ;;",
        "  *Password*) echo \"${DOCKER_GIT_GITLAB_TOKEN}\" ;;",
        "  *) echo \"${DOCKER_GIT_GITLAB_TOKEN}\" ;;",
        "esac",
        ""
      ].join("\n")
      yield* _(fs.writeFileString(askpassPath, contents))
      yield* _(fs.chmod(askpassPath, 0o700))
      const env: GitAuthEnv = {
        ...gitBaseEnv,
        DOCKER_GIT_GITLAB_TOKEN: token,
        GIT_ASKPASS: askpassPath,
        GIT_ASKPASS_REQUIRE: "force"
      }
      return yield* _(use(env))
    })
  )
/* jscpd:ignore-end */
