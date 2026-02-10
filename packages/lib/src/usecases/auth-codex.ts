import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import type { AuthCodexLoginCommand, AuthCodexLogoutCommand, AuthCodexStatusCommand } from "../core/domain.js"
import { defaultTemplateConfig } from "../core/domain.js"
import { runDockerAuth, runDockerAuthExitCode } from "../shell/docker-auth.js"
import { CommandFailedError } from "../shell/errors.js"
import { buildDockerAuthSpec, normalizeAccountLabel } from "./auth-helpers.js"
import { ensureCodexConfigFile, migrateLegacyOrchLayout } from "./auth-sync.js"
import { ensureDockerImage } from "./docker-image.js"
// NOTE: keep local helpers grouped to avoid duplicated import blocks.
import { resolvePathFromCwd } from "./path-helpers.js"
import { withFsPathContext } from "./runtime.js"

type CodexRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor

type CodexAccountContext = {
  readonly accountPath: string
  readonly cwd: string
}

const codexImageName = "docker-git-auth-codex:latest"
const codexImageDir = ".docker-git/.orch/auth/codex/.image"
const codexHome = "/root/.codex"

const ensureCodexOrchLayout = (
  cwd: string,
  codexAuthPath: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  migrateLegacyOrchLayout(
    cwd,
    defaultTemplateConfig.envGlobalPath,
    defaultTemplateConfig.envProjectPath,
    codexAuthPath,
    ".docker-git/.orch/auth/gh"
  )

const renderCodexDockerfile = (): string =>
  String.raw`FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates unzip bsdutils nodejs \
  && rm -rf /var/lib/apt/lists/*
ENV BUN_INSTALL=/usr/local/bun
ENV PATH="/usr/local/bun/bin:$PATH"
RUN curl -fsSL https://bun.sh/install | bash
RUN ln -sf /usr/local/bun/bin/bun /usr/local/bin/bun
RUN script -q -e -c "bun add -g @openai/codex@latest" /dev/null
RUN ln -sf /usr/local/bun/bin/codex /usr/local/bin/codex
`

const resolveCodexAccountPath = (rootPath: string, label: string | null): string => {
  const resolvedLabel = normalizeAccountLabel(label, "default")
  return resolvedLabel === "default" ? rootPath : `${rootPath}/${resolvedLabel}`
}

const withCodexAccount = <A, E>(
  codexAuthPath: string,
  label: string | null,
  run: (
    context: CodexAccountContext
  ) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor>
): Effect.Effect<A, E | PlatformError, FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor> =>
  withFsPathContext(({ cwd, fs, path }) =>
    Effect.gen(function*(_) {
      yield* _(ensureCodexOrchLayout(cwd, codexAuthPath))
      const rootPath = resolvePathFromCwd(path, cwd, codexAuthPath)
      const accountPath = resolveCodexAccountPath(rootPath, label)
      yield* _(ensureCodexConfigFile(cwd, accountPath))
      yield* _(fs.makeDirectory(accountPath, { recursive: true }))
      return yield* _(run({ accountPath, cwd }))
    })
  )

const withCodexAuth = <A, E>(
  command: AuthCodexLoginCommand | AuthCodexLogoutCommand | AuthCodexStatusCommand,
  run: (
    context: CodexAccountContext
  ) => Effect.Effect<A, E, CommandExecutor.CommandExecutor>
): Effect.Effect<A, E | PlatformError | CommandFailedError, CodexRuntime> =>
  withCodexAccount(command.codexAuthPath, command.label, ({ accountPath, cwd }) =>
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const path = yield* _(Path.Path)
      yield* _(
        ensureDockerImage(fs, path, cwd, {
          imageName: codexImageName,
          imageDir: codexImageDir,
          dockerfile: renderCodexDockerfile(),
          buildLabel: "codex auth"
        })
      )
      return yield* _(run({ accountPath, cwd }))
    }))

const runCodexAuthCommand = (
  cwd: string,
  accountPath: string,
  args: ReadonlyArray<string>,
  commandLabel: string,
  interactive: boolean
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runDockerAuth(
    buildDockerAuthSpec({
      cwd,
      image: codexImageName,
      hostPath: accountPath,
      containerPath: codexHome,
      env: `CODEX_HOME=${codexHome}`,
      args,
      interactive
    }),
    [0],
    (exitCode) => new CommandFailedError({ command: commandLabel, exitCode })
  )

const runCodexLogin = (
  cwd: string,
  accountPath: string
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCodexAuthCommand(cwd, accountPath, ["codex", "login", "--device-auth"], "codex login --device-auth", false)

const runCodexStatus = (
  cwd: string,
  accountPath: string
): Effect.Effect<number, PlatformError, CommandExecutor.CommandExecutor> =>
  runDockerAuthExitCode(
    buildDockerAuthSpec({
      cwd,
      image: codexImageName,
      hostPath: accountPath,
      containerPath: codexHome,
      env: `CODEX_HOME=${codexHome}`,
      args: ["codex", "login", "status"],
      interactive: false
    })
  )

const runCodexLogout = (
  cwd: string,
  accountPath: string
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCodexAuthCommand(cwd, accountPath, ["codex", "logout"], "codex logout", false)

// CHANGE: login to Codex CLI using a dedicated auth container
// WHY: keep auth isolated from the host toolchain
// QUOTE(ТЗ): "поднимал отдельный контейнер где будет установлен чисто gh или чисто codex"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall p: login(p) -> codex_auth(p)
// PURITY: SHELL
// EFFECT: Effect<void, CommandFailedError | PlatformError, FileSystem | Path | CommandExecutor>
// INVARIANT: CODEX_HOME is set to the resolved auth directory
// COMPLEXITY: O(command)
export const authCodexLogin = (
  command: AuthCodexLoginCommand
): Effect.Effect<void, CommandFailedError | PlatformError, CodexRuntime> =>
  withCodexAuth(command, ({ accountPath, cwd }) => runCodexLogin(cwd, accountPath))

// CHANGE: show Codex auth status for a given label
// WHY: make it obvious whether Codex is connected
// QUOTE(ТЗ): "поднимал отдельный контейнер где будет установлен чисто gh или чисто codex"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall p: status(p) -> connected(p) | disconnected(p)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem | Path | CommandExecutor>
// INVARIANT: never logs credentials
// COMPLEXITY: O(command)
export const authCodexStatus = (
  command: AuthCodexStatusCommand
): Effect.Effect<void, PlatformError | CommandFailedError, CodexRuntime> =>
  withCodexAuth(command, ({ accountPath, cwd }) =>
    Effect.gen(function*(_) {
      const exitCode = yield* _(runCodexStatus(cwd, accountPath))
      if (exitCode === 0) {
        yield* _(Effect.log(`Codex connected (${accountPath}).`))
        return
      }
      if (exitCode === 1) {
        yield* _(Effect.log(`Codex not connected (${accountPath}).`))
        return
      }
      return yield* _(Effect.fail(new CommandFailedError({ command: "codex login status", exitCode })))
    }))

// CHANGE: logout Codex by clearing credentials for a label
// WHY: allow revoking Codex access deterministically
// QUOTE(ТЗ): "поднимал отдельный контейнер где будет установлен чисто gh или чисто codex"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall p: logout(p) -> credentials_cleared(p)
// PURITY: SHELL
// EFFECT: Effect<void, CommandFailedError | PlatformError, FileSystem | Path | CommandExecutor>
// INVARIANT: codex auth state reflects CODEX_HOME after logout
// COMPLEXITY: O(command)
export const authCodexLogout = (
  command: AuthCodexLogoutCommand
): Effect.Effect<void, CommandFailedError | PlatformError, CodexRuntime> =>
  withCodexAuth(command, ({ accountPath, cwd }) => runCodexLogout(cwd, accountPath))
