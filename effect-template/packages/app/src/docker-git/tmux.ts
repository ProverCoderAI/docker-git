import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect, pipe } from "effect"

import type { AttachCommand, PanesCommand } from "@effect-template/lib/core/domain"
import { deriveRepoPathParts, deriveRepoSlug } from "@effect-template/lib/core/domain"
import {
  runCommandCapture,
  runCommandExitCode,
  runCommandWithExitCodes
} from "@effect-template/lib/shell/command-runner"
import { readProjectConfig } from "@effect-template/lib/shell/config"
import { runDockerComposeUp } from "@effect-template/lib/shell/docker"
import type { ConfigDecodeError, ConfigNotFoundError, DockerCommandError } from "@effect-template/lib/shell/errors"
import { CommandFailedError } from "@effect-template/lib/shell/errors"
import { resolveBaseDir } from "@effect-template/lib/shell/paths"
import { findSshPrivateKey } from "@effect-template/lib/usecases/path-helpers"
import { buildSshCommand } from "@effect-template/lib/usecases/projects"

const tmuxOk = [0]
const layoutVersion = "v14"

const makeTmuxSpec = (args: ReadonlyArray<string>) => ({
  cwd: process.cwd(),
  command: "tmux",
  args
})

const runTmux = (
  args: ReadonlyArray<string>
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandWithExitCodes(
    makeTmuxSpec(args),
    tmuxOk,
    (exitCode) => new CommandFailedError({ command: "tmux", exitCode })
  )

const runTmuxExitCode = (
  args: ReadonlyArray<string>
): Effect.Effect<number, PlatformError, CommandExecutor.CommandExecutor> => runCommandExitCode(makeTmuxSpec(args))

const runTmuxCapture = (
  args: ReadonlyArray<string>
): Effect.Effect<string, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandCapture(
    makeTmuxSpec(args),
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
    "clear",
    "echo \"LIVE TERMINALS / JOBS (container, refresh 1s)\"",
    "echo \"\"",
    `docker exec ${containerName} ps -eo pid,tty,cmd,etime --sort=start_time 2>/dev/null | awk 'NR==1 {print; next} $2 != "?" && $3 !~ /(sshd|^-?bash$|^bash$|^sh$|^zsh$|^fish$)/ {print; found=1} END { if (!found) print "(no interactive jobs)" }'`,
    "|| echo \"container not running\"",
    "sleep 1",
    "done"
  ].join("; ")

const readLayoutVersion = (
  session: string
): Effect.Effect<string | null, PlatformError, CommandExecutor.CommandExecutor> =>
  runTmuxCapture(["show-options", "-t", session, "-v", "@docker-git-layout"]).pipe(
    Effect.map((value) => value.trim()),
    Effect.catchAll(() => Effect.succeed(null))
  )

const buildBottomBarCommand = (): string =>
  [
    "clear",
    "echo \"[Focus: Alt+1/2/3] [Select: Alt+s] [Detach: Alt+d]\"",
    "echo \"Tip: Mouse click = focus pane, Ctrl+a z = zoom\"",
    "while true; do sleep 3600; done"
  ].join("; ")

const formatRepoRefLabel = (repoRef: string): string => {
  const match = /refs\/pull\/(\d+)\/head/.exec(repoRef)
  const pr = match?.[1]
  return pr ? `PR#${pr}` : repoRef
}

const formatRepoDisplayName = (repoUrl: string): string => {
  const parts = deriveRepoPathParts(repoUrl)
  return parts.pathParts.length > 0 ? parts.pathParts.join("/") : repoUrl
}

type PaneRow = {
  readonly id: string
  readonly window: string
  readonly title: string
  readonly command: string
}

const normalizePaneCell = (value: string | undefined): string => value?.trim() ?? "-"

const parsePaneRow = (line: string): PaneRow => {
  const [id, window, title, command] = line.split("\t")
  return {
    id: normalizePaneCell(id),
    window: normalizePaneCell(window),
    title: normalizePaneCell(title),
    command: normalizePaneCell(command)
  }
}

const renderPaneRow = (row: PaneRow): string =>
  `- ${row.id}  ${row.window}  ${row.title === "-" ? row.command : row.title}  ${row.command}`

const configureSession = (
  session: string,
  repoDisplayName: string,
  statusRight: string
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    yield* _(runTmux(["set-option", "-t", session, "@docker-git-layout", layoutVersion]))
    yield* _(runTmux(["set-option", "-t", session, "window-size", "largest"]))
    yield* _(runTmux(["set-option", "-t", session, "aggressive-resize", "on"]))
    yield* _(runTmux(["set-option", "-t", session, "mouse", "on"]))
    yield* _(runTmux(["set-option", "-t", session, "focus-events", "on"]))
    yield* _(runTmux(["set-option", "-t", session, "prefix", "C-a"]))
    yield* _(runTmux(["unbind-key", "C-b"]))
    yield* _(runTmux(["set-option", "-t", session, "status", "on"]))
    yield* _(runTmux(["set-option", "-t", session, "status-position", "top"]))
    yield* _(runTmux(["set-option", "-t", session, "status-left", ` docker-git :: ${repoDisplayName} `]))
    yield* _(runTmux(["set-option", "-t", session, "status-right", ` ${statusRight} `]))
  })

const createLayout = (
  session: string
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    yield* _(runTmux(["new-session", "-d", "-s", session, "-n", "main"]))
    yield* _(runTmux(["split-window", "-v", "-p", "12", "-t", `${session}:0`]))
    yield* _(runTmux(["split-window", "-h", "-p", "35", "-t", `${session}:0.0`]))
  })

const setupPanes = (
  session: string,
  sshCommand: string,
  containerName: string
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const leftPane = "0"
    const bottomPane = "1"
    const rightPane = "2"
    yield* _(sendKeys(session, leftPane, sshCommand))
    yield* _(sendKeys(session, rightPane, wrapBash(buildJobsCommand(containerName))))
    yield* _(sendKeys(session, bottomPane, wrapBash(buildBottomBarCommand())))
    yield* _(runTmux(["bind-key", "-n", "M-1", "select-pane", "-t", `${session}:0.${leftPane}`]))
    yield* _(runTmux(["bind-key", "-n", "M-2", "select-pane", "-t", `${session}:0.${rightPane}`]))
    yield* _(runTmux(["bind-key", "-n", "M-3", "select-pane", "-t", `${session}:0.${bottomPane}`]))
    yield* _(runTmux(["bind-key", "-n", "M-d", "detach-client"]))
    yield* _(runTmux(["bind-key", "-n", "M-s", "choose-tree", "-Z"]))
    yield* _(runTmux(["select-pane", "-t", `${session}:0.${leftPane}`]))
  })

// CHANGE: list tmux panes for a docker-git project
// WHY: allow non-interactive inspection of terminal panes (CI/automation friendly)
// QUOTE(ТЗ): "сделай команду ... которая отобразит терминалы в докере"
// REF: user-request-2026-02-02-panes
// SOURCE: n/a
// FORMAT THEOREM: forall p: panes(p) -> deterministic output
// PURITY: SHELL
// EFFECT: Effect<void, CommandFailedError | ConfigNotFoundError | ConfigDecodeError | PlatformError, CommandExecutor | FileSystem | Path>
// INVARIANT: session name is deterministic from repo url
// COMPLEXITY: O(n) where n = number of panes
export const listTmuxPanes = (
  command: PanesCommand
): Effect.Effect<
  void,
  CommandFailedError | ConfigNotFoundError | ConfigDecodeError | PlatformError,
  CommandExecutor.CommandExecutor | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*(_) {
    const { resolved } = yield* _(resolveBaseDir(command.projectDir))
    const config = yield* _(readProjectConfig(resolved))
    const session = `dg-${deriveRepoSlug(config.template.repoUrl)}`
    const hasSessionCode = yield* _(runTmuxExitCode(["has-session", "-t", session]))
    if (hasSessionCode !== 0) {
      yield* _(Effect.logWarning(`tmux session ${session} not found. Run 'docker-git attach' first.`))
      return
    }
    const raw = yield* _(
      runTmuxCapture([
        "list-panes",
        "-s",
        "-t",
        session,
        "-F",
        "#{pane_id}\t#{window_name}\t#{pane_title}\t#{pane_current_command}"
      ])
    )
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
    const rows = lines.map((line) => parsePaneRow(line))
    yield* _(Effect.log(`Project: ${resolved}`))
    yield* _(Effect.log(`Session: ${session}`))
    if (rows.length === 0) {
      yield* _(Effect.log("No panes found."))
      return
    }
    for (const row of rows) {
      yield* _(Effect.log(renderPaneRow(row)))
    }
  })

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
    const repoDisplayName = formatRepoDisplayName(config.template.repoUrl)
    const refLabel = formatRepoRefLabel(config.template.repoRef)
    const statusRight =
      `SSH: ${config.template.sshUser}@localhost:${config.template.sshPort} | Repo: ${repoDisplayName} | Ref: ${refLabel} | Status: Running`
    const session = `dg-${deriveRepoSlug(config.template.repoUrl)}`

    yield* _(runDockerComposeUp(resolved))
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

    yield* _(createLayout(session))
    yield* _(configureSession(session, repoDisplayName, statusRight))
    yield* _(setupPanes(session, sshCommand, config.template.containerName))
    yield* _(runTmux(["attach", "-t", session]))
  })
