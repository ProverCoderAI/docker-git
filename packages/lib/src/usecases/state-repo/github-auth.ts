import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"
import { parseEnvEntries } from "../env-file.js"
import { gitBaseEnv } from "./git-commands.js"

const githubTokenKey = "GITHUB_TOKEN"

const githubHttpsRemoteRe = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/
const githubSshRemoteRe = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/
const githubSshUrlRemoteRe = /^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?$/

type GithubRemoteParts = {
  readonly owner: string
  readonly repo: string
}

const tryParseGithubRemoteParts = (originUrl: string): GithubRemoteParts | null => {
  const trimmed = originUrl.trim()
  const match = githubHttpsRemoteRe.exec(trimmed) ??
    githubSshRemoteRe.exec(trimmed) ??
    githubSshUrlRemoteRe.exec(trimmed)
  if (match === null) {
    return null
  }
  const owner = match[1] ?? ""
  const repo = match[2] ?? ""
  return owner.length > 0 && repo.length > 0 ? { owner, repo } : null
}

export const tryBuildGithubCompareUrl = (
  originUrl: string,
  baseBranch: string,
  headBranch: string
): string | null => {
  const parts = tryParseGithubRemoteParts(originUrl)
  if (parts === null) {
    return null
  }
  return `https://github.com/${parts.owner}/${parts.repo}/compare/${encodeURIComponent(baseBranch)}...${
    encodeURIComponent(headBranch)
  }?expand=1`
}

export const isGithubHttpsRemote = (url: string): boolean => /^https:\/\/github\.com\//.test(url.trim())

const resolveTokenFromProcessEnv = (): string | null => {
  const github = process.env["GITHUB_TOKEN"]
  if (github !== undefined) {
    const trimmed = github.trim()
    if (trimmed.length > 0) {
      return trimmed
    }
  }

  const gh = process.env["GH_TOKEN"]
  if (gh !== undefined) {
    const trimmed = gh.trim()
    if (trimmed.length > 0) {
      return trimmed
    }
  }

  return null
}

type EnvEntry = {
  readonly key: string
  readonly value: string
}

const findTokenInEnvEntries = (entries: ReadonlyArray<EnvEntry>): string | null => {
  const directEntry = entries.find((e) => e.key === githubTokenKey)
  if (directEntry !== undefined) {
    const direct = directEntry.value.trim()
    if (direct.length > 0) {
      return direct
    }
  }

  const labeledEntry = entries.find((e) => e.key.startsWith("GITHUB_TOKEN__"))
  if (labeledEntry !== undefined) {
    const labeled = labeledEntry.value.trim()
    if (labeled.length > 0) {
      return labeled
    }
  }

  return null
}

export const resolveGithubToken = (
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
      // Canonical layout: ~/.docker-git/.orch/env/global.env
      path.join(root, ".orch", "env", "global.env"),
      // Legacy layout (kept for backward compatibility): ~/.docker-git/secrets/global.env
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

export type GitAuthEnv = Readonly<Record<string, string | undefined>>

export const withGithubAskpassEnv = <A, E, R>(
  token: string,
  use: (env: GitAuthEnv) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | PlatformError, FileSystem.FileSystem | R> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const askpassPath = yield* _(fs.makeTempFileScoped({ prefix: "docker-git-askpass-" }))
      const contents = [
        "#!/bin/sh",
        "case \"$1\" in",
        "  *Username*) echo \"x-access-token\" ;;",
        "  *Password*) echo \"${DOCKER_GIT_GITHUB_TOKEN}\" ;;",
        "  *) echo \"${DOCKER_GIT_GITHUB_TOKEN}\" ;;",
        "esac",
        ""
      ].join("\n")
      yield* _(fs.writeFileString(askpassPath, contents))
      yield* _(fs.chmod(askpassPath, 0o700))
      const env: GitAuthEnv = {
        ...gitBaseEnv,
        DOCKER_GIT_GITHUB_TOKEN: token,
        GIT_ASKPASS: askpassPath,
        GIT_ASKPASS_REQUIRE: "force"
      }
      return yield* _(use(env))
    })
  )
