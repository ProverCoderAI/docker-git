import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { defaultTemplateConfig } from "@effect-template/lib/core/template-defaults"
import { buildDockerAuthArgs, resolveDockerVolumeHostPath, runDockerAuthCapture } from "@effect-template/lib/shell/docker-auth"
import { CommandFailedError } from "@effect-template/lib/shell/errors"
import { buildDockerAuthSpec, normalizeAccountLabel } from "@effect-template/lib/usecases/auth-helpers"
import { migrateLegacyOrchLayout } from "@effect-template/lib/usecases/auth-sync"
import { buildGitlabTokenKey, extractGitlabTokenFromStatusOutput, gitlabLabelFromKey } from "@effect-template/lib/usecases/auth-gitlab"
import { ensureEnvFile, readEnvText, upsertEnvKey } from "@effect-template/lib/usecases/env-file"
import { ensureGlabAuthImage, gitlabAuthDir, gitlabAuthRoot, gitlabImageName } from "@effect-template/lib/usecases/gitlab-auth-image"
import { resolvePathFromCwd } from "@effect-template/lib/usecases/path-helpers"
import { autoSyncState } from "@effect-template/lib/usecases/state-repo"
import { Effect, Logger, Runtime } from "effect"
import * as Stream from "effect/Stream"
import { spawn, type ChildProcess } from "node:child_process"

import type { GitlabAuthLoginRequest } from "../api/contracts.js"
import { ApiBadRequestError, ApiInternalError } from "../api/errors.js"

type GitlabRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
type GitlabSetupError = CommandFailedError | PlatformError

type PreparedGitlabLogin = {
  readonly cwd: string
  readonly args: ReadonlyArray<string>
  readonly accountPath: string
  readonly envPath: string
  readonly key: string
  readonly label: string
}

const gitlabLoginStreamSuccessMarker = "__DOCKER_GIT_GITLAB_LOGIN_STATUS__:ok"
const gitlabLoginStreamErrorMarkerPrefix = "__DOCKER_GIT_GITLAB_LOGIN_STATUS__:error:"

const ensureGitlabOrchLayout = (
  cwd: string,
  envGlobalPath: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  migrateLegacyOrchLayout(cwd, {
    envGlobalPath,
    envProjectPath: defaultTemplateConfig.envProjectPath,
    codexAuthPath: defaultTemplateConfig.codexAuthPath,
    ghAuthPath: ".docker-git/.orch/auth/gh",
    gitlabAuthPath: gitlabAuthRoot,
    claudeAuthPath: ".docker-git/.orch/auth/claude"
  })

const toApiError = (error: GitlabSetupError): ApiBadRequestError | ApiInternalError =>
  error._tag === "CommandFailedError"
    ? new ApiBadRequestError({
      message: `${error.command} failed (exit ${error.exitCode}).`
    })
    : new ApiInternalError({
      message: String(error),
      cause: error
    })

const prepareGitlabLogin = (
  request: GitlabAuthLoginRequest
): Effect.Effect<PreparedGitlabLogin, ApiBadRequestError | ApiInternalError, GitlabRuntime> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const cwd = process.cwd()

    yield* _(
      ensureGitlabOrchLayout(cwd, defaultTemplateConfig.envGlobalPath).pipe(
        Effect.mapError(toApiError)
      )
    )

    const envPath = resolvePathFromCwd(path, cwd, defaultTemplateConfig.envGlobalPath)
    const rootPath = resolvePathFromCwd(path, cwd, gitlabAuthRoot)
    const label = normalizeAccountLabel(request.label ?? null, "default")
    const accountPath = path.join(rootPath, label)
    const key = buildGitlabTokenKey(request.label ?? null)

    yield* _(fs.makeDirectory(accountPath, { recursive: true }).pipe(Effect.mapError(toApiError)))
    yield* _(ensureGlabAuthImage(fs, path, cwd, "glab auth").pipe(Effect.mapError(toApiError)))

    const hostPath = yield* _(resolveDockerVolumeHostPath(cwd, accountPath).pipe(Effect.mapError(toApiError)))
    const args = buildDockerAuthArgs(
      buildDockerAuthSpec({
        cwd,
        image: gitlabImageName,
        hostPath,
        containerPath: gitlabAuthDir,
        env: ["BROWSER=echo", `GLAB_CONFIG_DIR=${gitlabAuthDir}`],
        args: [
          "auth",
          "login",
          "--hostname",
          "gitlab.com",
          "--web",
          "--git-protocol",
          "https"
        ],
        interactive: false
      })
    )

    return {
      cwd,
      args,
      accountPath,
      envPath,
      key,
      label: gitlabLabelFromKey(key)
    }
  })

const resolveGitlabToken = (
  cwd: string,
  accountPath: string
): Effect.Effect<string, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runDockerAuthCapture(
    buildDockerAuthSpec({
      cwd,
      image: gitlabImageName,
      hostPath: accountPath,
      containerPath: gitlabAuthDir,
      env: `GLAB_CONFIG_DIR=${gitlabAuthDir}`,
      args: ["auth", "status", "--hostname", "gitlab.com", "--show-token"],
      interactive: false
    }),
    [0],
    (exitCode) => new CommandFailedError({ command: "glab auth status --show-token", exitCode })
  ).pipe(
    Effect.map((raw) => extractGitlabTokenFromStatusOutput(raw)),
    Effect.filterOrFail(
      (value): value is string => value !== null && value.length > 0,
      () => new CommandFailedError({ command: "glab auth status --show-token", exitCode: 1 })
    )
  )

const persistGitlabToken = (
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
    ? `\nGitLab login completed.\n${gitlabLoginStreamSuccessMarker}\n`
    : `\n${gitlabLoginStreamErrorMarkerPrefix}${status}\n`

const normalizeCapturedLogLines = (lines: ReadonlyArray<string>): ReadonlyArray<string> =>
  lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

export const renderGitlabPostLoginOutput = (
  lines: ReadonlyArray<string>,
  status: string
): string => {
  const output = normalizeCapturedLogLines(lines).join("\n")
  const logBlock = output.length === 0 ? "" : `\n${output}\n`
  return `${logBlock}${finalizeMessage(status)}`
}

const toStreamError = (error: unknown): ApiInternalError | ApiBadRequestError =>
  error instanceof ApiBadRequestError || error instanceof ApiInternalError
    ? error
    : new ApiInternalError({
      message: String(error),
      cause: error
    })

const finalizeGitlabLogin = (
  prepared: PreparedGitlabLogin
): Effect.Effect<void, ApiBadRequestError | ApiInternalError, GitlabRuntime> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const token = yield* _(resolveGitlabToken(prepared.cwd, prepared.accountPath).pipe(Effect.mapError(toApiError)))
    yield* _(ensureEnvFile(fs, path, prepared.envPath).pipe(Effect.mapError(toApiError)))
    yield* _(persistGitlabToken(fs, prepared.envPath, prepared.key, token).pipe(Effect.mapError(toApiError)))
    yield* _(autoSyncState(`chore(state): auth gitlab ${prepared.label}`))
  })

export const streamGitlabAuthLogin = (
  request: GitlabAuthLoginRequest
): Effect.Effect<Stream.Stream<Uint8Array, ApiBadRequestError | ApiInternalError>, ApiBadRequestError | ApiInternalError, GitlabRuntime> =>
  Effect.gen(function*(_) {
    const prepared = yield* _(prepareGitlabLogin(request))
    const encoder = new TextEncoder()
    const runPromiseExit = Runtime.runPromiseExit(yield* _(Effect.runtime<GitlabRuntime>()))

    let child: ChildProcess | null = null
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        const enqueue = (chunk: Buffer | string) => {
          const encoded = typeof chunk === "string" ? encoder.encode(chunk) : new Uint8Array(chunk)
          controller.enqueue(encoded)
        }

        enqueue("Starting GitLab auth login in container...\n")

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

          const postLoginLogs: Array<string> = []
          const logger = Logger.make(({ message }) => {
            postLoginLogs.push(String(message))
          })

          void runPromiseExit(
            finalizeGitlabLogin(prepared).pipe(
              Effect.provide(Logger.replace(Logger.defaultLogger, logger)),
              Effect.matchEffect({
                onFailure: (error) =>
                  Effect.sync(() => {
                    enqueue(renderGitlabPostLoginOutput([
                      ...postLoginLogs,
                      `GitLab login finished in browser, but post-login sync failed: ${error.message}`
                    ], "post-login"))
                  }),
                onSuccess: () =>
                  Effect.sync(() => {
                    enqueue(renderGitlabPostLoginOutput(postLoginLogs, "ok"))
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
