import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect, pipe } from "effect"

import type { AttachCommand } from "../core/domain.js"
import { deriveRepoSlug } from "../core/domain.js"
import { readProjectConfig } from "../shell/config.js"
import { runCommandCapture, runCommandExitCode, runCommandWithExitCodes } from "../shell/command-runner.js"
import { runDockerComposeUp } from "../shell/docker.js"
import type { ConfigDecodeError, ConfigNotFoundError, DockerCommandError } from "../shell/errors.js"
import { CommandFailedError } from "../shell/errors.js"
import { resolveBaseDir } from "../shell/paths.js"
import { buildSshCommand } from "./projects.js"
import { findSshPrivateKey } from "./path-helpers.js"

const tmuxOk = [0]
const layoutVersion = "v2"

const runTmux = (
  args: ReadonlyArray<string>
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandWithExitCodes(
    {
      cwd: process.cwd(),
      command: "tmux",
      args
    },
    tmuxOk,
    (exitCode) => new CommandFailedError({ command: "tmux", exitCode })
  )

const runTmuxExitCode = (
  args: ReadonlyArray<string>
): Effect.Effect<number, PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandExitCode({
    cwd: process.cwd(),
    command: "tmux",
    args
  })

const runTmuxCapture = (
  args: ReadonlyArray<string>
): Effect.Effect<string, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandCapture(
    {
      cwd: process.cwd(),
      command: "tmux",
      args
    },
    tmuxOk,
    (exitCode) => new CommandFailedError({ command: "tmux", exitCode })
  )

const sendKeys = (
  session: string,
  pane: string,
  text: string
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  pipe(
    runTmux(["send-keys", "-t", `${session}:0.${pane}`, "-l", text]),
    Effect.zipRight(runTmux(["send-keys", "-t", `${session}:0.${pane}`, "C-m"]))
  )

const shellEscape = (value: string): string => {
  if (value.length === 0) {
    return "''"
  }
  if (!/[^\w@%+=:,./-]/.test(value)) {
    return value
  }
  const escaped = value.replaceAll("'", "'\"'\"'")
  return `'${escaped}'`
}

const wrapBash = (command: string): string => `bash -lc ${shellEscape(command)}`

const buildJobsCommand = (containerName: string): string =>
  [
    "while true; do",
    "clear;",
    "date;",
    `docker exec ${containerName} ps -eo pid,cmd,etime --sort=start_time 2>/dev/null || echo \"container not running\";`,
    "sleep 1;",
    "done"
  ].join(" ")

const readLayoutVersion = (
  session: string
): Effect.Effect<string | null, PlatformError, CommandExecutor.CommandExecutor> =>
  runTmuxCapture(["show-options", "-t", session, "-v", "@docker-git-layout"]).pipe(
    Effect.map((value) => value.trim()),
    Effect.catchAll(() => Effect.succeed(null))
  )

const buildActionsCommand = (): string =>
  [
    "clear;",
    "echo \"Actions:\";",
    "echo \"  docker-git ps\";",
    "echo \"  docker-git logs\";",
    "echo \"  docker-git status\";",
    "echo \"  docker exec <container> ps -eo pid,cmd,etime\";",
    "echo \"\";",
    "echo \"Tip: use Ctrl+b z to zoom a pane\";"
  ].join(" ")

// CHANGE: attach a tmux workspace for a docker-git project
// WHY: provide multi-pane terminal layout for sandbox work
// QUOTE(ТЗ): "окей Давай подключим tmux"
// REF: user-request-2026-02-02-tmux
// SOURCE: n/a
// FORMAT THEOREM: forall p: attach(p) -> tmux(p)
// PURITY: SHELL
// EFFECT: Effect<void, CommandFailedError | DockerCommandError | ConfigNotFoundError | ConfigDecodeError | PlatformError, CommandExecutor | FileSystem | Path>
// INVARIANT: tmux session name is deterministic from repo url
// COMPLEXITY: O(1)
export const attachTmux = (
  command: AttachCommand
): Effect.Effect<
  void,
  CommandFailedError | DockerCommandError | ConfigNotFoundError | ConfigDecodeError | PlatformError,
  CommandExecutor.CommandExecutor | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*(_) {
    const { fs, path, resolved } = yield* _(resolveBaseDir(command.projectDir))
    const config = yield* _(readProjectConfig(resolved))
    const sshKey = yield* _(findSshPrivateKey(fs, path, process.cwd()))
    const sshCommand = buildSshCommand(config.template, sshKey)
    const session = `dg-${deriveRepoSlug(config.template.repoUrl)}`
    const hasSessionCode = yield* _(runTmuxExitCode(["has-session", "-t", session]))

    if (hasSessionCode === 0) {
      const existingLayout = yield* _(readLayoutVersion(session))
      if (existingLayout === layoutVersion) {
        yield* _(runTmux(["attach", "-t", session]))
        return
      }
      yield* _(Effect.logWarning(`tmux session ${session} uses an old layout; recreating.`))
      yield* _(runTmux(["kill-session", "-t", session]))
    }

    yield* _(runDockerComposeUp(resolved))
    yield* _(runTmux(["new-session", "-d", "-s", session, "-n", "main"]))
    yield* _(runTmux(["set-option", "-t", session, "@docker-git-layout", layoutVersion]))
    yield* _(runTmux(["split-window", "-v", "-p", "25", "-t", `${session}:0`]))
    yield* _(runTmux(["split-window", "-h", "-p", "35", "-t", `${session}:0.0`]))
    yield* _(sendKeys(session, "0", sshCommand))
    yield* _(sendKeys(session, "2", wrapBash(buildJobsCommand(config.template.containerName))))
    yield* _(
      sendKeys(session, "1", wrapBash(`${buildActionsCommand()}; while true; do sleep 3600; done`))
    )
    yield* _(runTmux(["select-pane", "-t", `${session}:0.0`]))
    yield* _(runTmux(["attach", "-t", session]))
  })
