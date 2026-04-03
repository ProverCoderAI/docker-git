import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { defaultTemplateConfig } from "@effect-template/lib/core/template-defaults"
import { buildDockerAuthArgs, resolveDockerVolumeHostPath } from "@effect-template/lib/shell/docker-auth"
import { CommandFailedError } from "@effect-template/lib/shell/errors"
import { buildDockerAuthSpec, normalizeAccountLabel } from "@effect-template/lib/usecases/auth-helpers"
import { ensureCodexConfigFile, migrateLegacyOrchLayout } from "@effect-template/lib/usecases/auth-sync"
import { ensureDockerImage } from "@effect-template/lib/usecases/docker-image"
import { resolvePathFromCwd } from "@effect-template/lib/usecases/path-helpers"
import { autoSyncState } from "@effect-template/lib/usecases/state-repo"
import { Effect, Runtime } from "effect"
import * as Stream from "effect/Stream"
import { spawn, type ChildProcess } from "node:child_process"

import type { CodexAuthLoginRequest } from "../api/contracts.js"
import { ApiBadRequestError, ApiInternalError } from "../api/errors.js"

type CodexRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
type CodexSetupError = CommandFailedError | PlatformError

type PreparedCodexLogin = {
  readonly cwd: string
  readonly args: ReadonlyArray<string>
  readonly label: string
}

const codexImageName = "docker-git-auth-codex:latest"
const codexImageDir = ".docker-git/.orch/auth/codex/.image"
const codexHome = "/codex-home"

export const codexLoginStreamSuccessMarker = "__DOCKER_GIT_CODEX_LOGIN_STATUS__:ok"
export const codexLoginStreamErrorMarkerPrefix = "__DOCKER_GIT_CODEX_LOGIN_STATUS__:error:"

const ensureCodexOrchLayout = (
  cwd: string,
  codexAuthPath: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  migrateLegacyOrchLayout(cwd, {
    envGlobalPath: defaultTemplateConfig.envGlobalPath,
    envProjectPath: defaultTemplateConfig.envProjectPath,
    codexAuthPath,
    ghAuthPath: ".docker-git/.orch/auth/gh",
    claudeAuthPath: ".docker-git/.orch/auth/claude"
  })

const renderCodexDockerfile = (): string =>
  String.raw`FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates unzip bsdutils nodejs \
  && rm -rf /var/lib/apt/lists/*
ENV BUN_INSTALL=/usr/local/bun
ENV PATH="/usr/local/bun/bin:$PATH"
RUN set -eu; \
  for attempt in 1 2 3 4 5; do \
    if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 https://bun.sh/install -o /tmp/bun-install.sh \
      && BUN_INSTALL=/usr/local/bun bash /tmp/bun-install.sh; then \
      rm -f /tmp/bun-install.sh; \
      exit 0; \
    fi; \
    echo "bun install attempt \${attempt} failed; retrying..." >&2; \
    rm -f /tmp/bun-install.sh; \
    sleep $((attempt * 2)); \
  done; \
  echo "bun install failed after retries" >&2; \
  exit 1
RUN ln -sf /usr/local/bun/bin/bun /usr/local/bin/bun
RUN script -q -e -c "bun add -g @openai/codex@latest" /dev/null
RUN ln -sf /usr/local/bun/bin/codex /usr/local/bin/codex
`

const resolveCodexAccountPath = (rootPath: string, label: string | null): string => {
  const resolvedLabel = normalizeAccountLabel(label, "default")
  return resolvedLabel === "default" ? rootPath : `${rootPath}/${resolvedLabel}`
}

const toApiError = (error: CodexSetupError): ApiBadRequestError | ApiInternalError =>
  error._tag === "CommandFailedError"
    ? new ApiBadRequestError({
      message: `${error.command} failed (exit ${error.exitCode}).`
    })
    : new ApiInternalError({
      message: String(error),
      cause: error
    })

const prepareCodexLogin = (
  request: CodexAuthLoginRequest
): Effect.Effect<PreparedCodexLogin, ApiBadRequestError | ApiInternalError, CodexRuntime> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const cwd = process.cwd()

    yield* _(ensureCodexOrchLayout(cwd, defaultTemplateConfig.codexAuthPath).pipe(Effect.mapError(toApiError)))

    const rootPath = resolvePathFromCwd(path, cwd, defaultTemplateConfig.codexAuthPath)
    const label = normalizeAccountLabel(request.label ?? null, "default")
    const accountPath = resolveCodexAccountPath(rootPath, request.label ?? null)
    yield* _(ensureCodexConfigFile(cwd, accountPath).pipe(Effect.mapError(toApiError)))
    yield* _(fs.makeDirectory(accountPath, { recursive: true }).pipe(Effect.mapError(toApiError)))
    yield* _(
      ensureDockerImage(fs, path, cwd, {
        imageName: codexImageName,
        imageDir: codexImageDir,
        dockerfile: renderCodexDockerfile(),
        buildLabel: "codex auth"
      }).pipe(Effect.mapError(toApiError))
    )

    const hostPath = yield* _(resolveDockerVolumeHostPath(cwd, accountPath))
    const args = buildDockerAuthArgs(
      buildDockerAuthSpec({
        cwd,
        image: codexImageName,
        hostPath,
        containerPath: codexHome,
        env: `CODEX_HOME=${codexHome}`,
        args: ["codex", "login", "--device-auth"],
        interactive: false
      })
    )

    return { cwd, args, label }
  })

const toStreamError = (error: unknown): ApiInternalError | ApiBadRequestError =>
  error instanceof ApiBadRequestError || error instanceof ApiInternalError
    ? error
    : new ApiInternalError({
      message: String(error),
      cause: error
    })

const finalizeMessage = (exitCode: number): string =>
  exitCode === 0
    ? `\nCodex login completed.\n${codexLoginStreamSuccessMarker}\n`
    : `\n${codexLoginStreamErrorMarkerPrefix}${exitCode}\n`

export const streamCodexAuthLogin = (
  request: CodexAuthLoginRequest
): Effect.Effect<Stream.Stream<Uint8Array, ApiBadRequestError | ApiInternalError>, ApiBadRequestError | ApiInternalError, CodexRuntime> =>
  Effect.gen(function*(_) {
    const prepared = yield* _(prepareCodexLogin(request))
    const encoder = new TextEncoder()
    const runPromiseExit = Runtime.runPromiseExit(yield* _(Effect.runtime<CodexRuntime>()))

    let child: ChildProcess | null = null
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        child = spawn("docker", prepared.args, {
          cwd: prepared.cwd,
          stdio: ["ignore", "pipe", "pipe"]
        })

        const enqueue = (chunk: Buffer | string) => {
          const encoded = typeof chunk === "string" ? encoder.encode(chunk) : new Uint8Array(chunk)
          controller.enqueue(encoded)
        }

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
            enqueue(finalizeMessage(exitCode))
            controller.close()
            return
          }

          void runPromiseExit(
            autoSyncState(`chore(state): auth codex ${prepared.label}`).pipe(
              Effect.catchAll((error) =>
                Effect.sync(() => {
                  enqueue(`\nCodex login completed, but state sync failed: ${String(error)}\n`)
                })
              ),
              Effect.asVoid
            )
          ).finally(() => {
            enqueue(finalizeMessage(0))
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
