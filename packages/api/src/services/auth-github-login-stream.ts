import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { defaultTemplateConfig } from "@effect-template/lib/core/template-defaults"
import { buildDockerAuthArgs, resolveDockerVolumeHostPath, runDockerAuthCapture } from "@effect-template/lib/shell/docker-auth"
import { CommandFailedError } from "@effect-template/lib/shell/errors"
import { buildDockerAuthSpec, normalizeAccountLabel } from "@effect-template/lib/usecases/auth-helpers"
import { ensureEnvFile, readEnvText, upsertEnvKey } from "@effect-template/lib/usecases/env-file"
import { ensureGhAuthImage, ghAuthDir, ghAuthRoot, ghImageName } from "@effect-template/lib/usecases/github-auth-image"
import { resolvePathFromCwd } from "@effect-template/lib/usecases/path-helpers"
import { autoSyncState } from "@effect-template/lib/usecases/state-repo"
import { ensureStateDotDockerGitRepo } from "@effect-template/lib/usecases/state-repo-github"
import { migrateLegacyOrchLayout } from "@effect-template/lib/usecases/auth-sync"
import { Effect, Runtime } from "effect"
import * as Stream from "effect/Stream"
import { spawn, type ChildProcess } from "node:child_process"

import type { GithubAuthLoginRequest } from "../api/contracts.js"
import { ApiBadRequestError, ApiInternalError } from "../api/errors.js"

type GithubRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
type GithubSetupError = CommandFailedError | PlatformError

type PreparedGithubLogin = {
  readonly cwd: string
  readonly args: ReadonlyArray<string>
  readonly accountPath: string
  readonly envPath: string
  readonly key: string
  readonly label: string
  readonly scopes: ReadonlyArray<string>
}

const githubLoginStreamSuccessMarker = "__DOCKER_GIT_GITHUB_LOGIN_STATUS__:ok"
const githubLoginStreamErrorMarkerPrefix = "__DOCKER_GIT_GITHUB_LOGIN_STATUS__:error:"
const githubTokenKey = "GITHUB_TOKEN"
const githubTokenPrefix = "GITHUB_TOKEN__"
const defaultGithubScopes = "repo,workflow,read:org"

const ensureGithubOrchLayout = (
  cwd: string,
  envGlobalPath: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  migrateLegacyOrchLayout(cwd, {
    envGlobalPath,
    envProjectPath: defaultTemplateConfig.envProjectPath,
    codexAuthPath: defaultTemplateConfig.codexAuthPath,
    ghAuthPath: ghAuthRoot,
    claudeAuthPath: ".docker-git/.orch/auth/claude"
  })

const normalizeGithubLabel = (value: string | null): string => {
  const trimmed = value?.trim() ?? ""
  if (trimmed.length === 0) {
    return ""
  }
  const normalized = trimmed.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_")
  const withoutLeading = normalized.replace(/^_+/u, "")
  const cleaned = withoutLeading.replace(/_+$/u, "")
  return cleaned.length > 0 ? cleaned : ""
}

const buildGithubTokenKey = (label: string | null): string => {
  const normalized = normalizeGithubLabel(label)
  if (normalized === "DEFAULT" || normalized.length === 0) {
    return githubTokenKey
  }
  return `${githubTokenPrefix}${normalized}`
}

const labelFromKey = (key: string): string => key.startsWith(githubTokenPrefix) ? key.slice(githubTokenPrefix.length) : "default"

const normalizeGithubScopes = (value: string | null | undefined): ReadonlyArray<string> => {
  const raw = value?.trim() ?? ""
  const input = raw.length === 0 ? defaultGithubScopes : raw
  const scopes = input
    .split(/[,\s]+/g)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0 && scope !== "delete_repo")
  return scopes.length === 0 ? defaultGithubScopes.split(",") : scopes
}

const toApiError = (error: GithubSetupError): ApiBadRequestError | ApiInternalError =>
  error._tag === "CommandFailedError"
    ? new ApiBadRequestError({
      message: `${error.command} failed (exit ${error.exitCode}).`
    })
    : new ApiInternalError({
      message: String(error),
      cause: error
    })

const prepareGithubLogin = (
  request: GithubAuthLoginRequest
): Effect.Effect<PreparedGithubLogin, ApiBadRequestError | ApiInternalError, GithubRuntime> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const cwd = process.cwd()

    yield* _(
      ensureGithubOrchLayout(cwd, defaultTemplateConfig.envGlobalPath).pipe(
        Effect.mapError(toApiError)
      )
    )

    const envPath = resolvePathFromCwd(path, cwd, defaultTemplateConfig.envGlobalPath)
    const rootPath = resolvePathFromCwd(path, cwd, ghAuthRoot)
    const label = normalizeAccountLabel(request.label ?? null, "default")
    const accountPath = path.join(rootPath, label)
    const scopes = normalizeGithubScopes(request.scopes)

    yield* _(fs.makeDirectory(accountPath, { recursive: true }).pipe(Effect.mapError(toApiError)))
    yield* _(ensureGhAuthImage(fs, path, cwd, "gh auth").pipe(Effect.mapError(toApiError)))

    const hostPath = yield* _(resolveDockerVolumeHostPath(cwd, accountPath).pipe(Effect.mapError(toApiError)))
    const args = buildDockerAuthArgs(
      buildDockerAuthSpec({
        cwd,
        image: ghImageName,
        hostPath,
        containerPath: ghAuthDir,
        env: ["BROWSER=echo", `GH_CONFIG_DIR=${ghAuthDir}`],
        args: [
          "auth",
          "login",
          "--web",
          "-h",
          "github.com",
          "-p",
          "https",
          ...(scopes.length > 0 ? ["--scopes", scopes.join(",")] : [])
        ],
        interactive: false
      })
    )

    return {
      cwd,
      args,
      accountPath,
      envPath,
      key: buildGithubTokenKey(request.label ?? null),
      label: labelFromKey(buildGithubTokenKey(request.label ?? null)),
      scopes
    }
  })

const resolveGithubToken = (
  cwd: string,
  accountPath: string
): Effect.Effect<string, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runDockerAuthCapture(
    buildDockerAuthSpec({
      cwd,
      image: ghImageName,
      hostPath: accountPath,
      containerPath: ghAuthDir,
      env: `GH_CONFIG_DIR=${ghAuthDir}`,
      args: ["auth", "token"],
      interactive: false
    }),
    [0],
    (exitCode) => new CommandFailedError({ command: "gh auth token", exitCode })
  ).pipe(
    Effect.map((raw) => raw.trim()),
    Effect.filterOrFail(
      (value) => value.length > 0,
      () => new CommandFailedError({ command: "gh auth token", exitCode: 1 })
    )
  )

const persistGithubToken = (
  fs: FileSystem.FileSystem,
  envPath: string,
  key: string,
  token: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const current = yield* _(readEnvText(fs, envPath))
    const nextText = upsertEnvKey(current, key, token)
    yield* _(fs.writeFileString(envPath, nextText))
  })

const finalizeMessage = (status: string): string =>
  status === "ok"
    ? `\nGitHub login completed.\n${githubLoginStreamSuccessMarker}\n`
    : `\n${githubLoginStreamErrorMarkerPrefix}${status}\n`

const toStreamError = (error: unknown): ApiInternalError | ApiBadRequestError =>
  error instanceof ApiBadRequestError || error instanceof ApiInternalError
    ? error
    : new ApiInternalError({
      message: String(error),
      cause: error
    })

const finalizeGithubLogin = (
  prepared: PreparedGithubLogin
): Effect.Effect<void, ApiBadRequestError | ApiInternalError, GithubRuntime> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const token = yield* _(resolveGithubToken(prepared.cwd, prepared.accountPath).pipe(Effect.mapError(toApiError)))
    yield* _(ensureEnvFile(fs, path, prepared.envPath).pipe(Effect.mapError(toApiError)))
    yield* _(persistGithubToken(fs, prepared.envPath, prepared.key, token).pipe(Effect.mapError(toApiError)))
    yield* _(ensureStateDotDockerGitRepo(token))
    yield* _(autoSyncState(`chore(state): auth gh ${prepared.label}`))
  })

export const streamGithubAuthLogin = (
  request: GithubAuthLoginRequest
): Effect.Effect<Stream.Stream<Uint8Array, ApiBadRequestError | ApiInternalError>, ApiBadRequestError | ApiInternalError, GithubRuntime> =>
  Effect.gen(function*(_) {
    const prepared = yield* _(prepareGithubLogin(request))
    const encoder = new TextEncoder()
    const runPromiseExit = Runtime.runPromiseExit(yield* _(Effect.runtime<GithubRuntime>()))

    let child: ChildProcess | null = null
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        const enqueue = (chunk: Buffer | string) => {
          const encoded = typeof chunk === "string" ? encoder.encode(chunk) : new Uint8Array(chunk)
          controller.enqueue(encoded)
        }

        enqueue(`Starting GH auth login in container (scopes: ${prepared.scopes.join(", ")})...\n`)

        child = spawn("docker", prepared.args, {
          cwd: prepared.cwd,
          stdio: ["ignore", "pipe", "pipe"]
        })

        child.stdout?.on("data", enqueue)
        child.stderr?.on("data", enqueue)

        child.on("error", (error) => {
          controller.error(
            new ApiInternalError({
              message: String(error),
              cause: error
            })
          )
        })

        child.on("close", (code) => {
          const exitCode = code ?? 1
          if (exitCode !== 0) {
            enqueue(finalizeMessage(String(exitCode)))
            controller.close()
            return
          }

          void runPromiseExit(
            finalizeGithubLogin(prepared).pipe(
              Effect.matchEffect({
                onFailure: (error) =>
                  Effect.sync(() => {
                    enqueue(`\nGitHub login finished in browser, but post-login sync failed: ${error.message}\n`)
                    enqueue(finalizeMessage("post-login"))
                  }),
                onSuccess: () =>
                  Effect.sync(() => {
                    enqueue(finalizeMessage("ok"))
                  })
              })
            )
          ).finally(() => {
            controller.close()
          })
        })
      },
      cancel() {
        child?.kill("SIGTERM")
      }
    })

    return Stream.fromReadableStream({
      evaluate: () => readable,
      onError: toStreamError,
      releaseLockOnEnd: true
    })
  })
