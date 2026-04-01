import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type { FileSystem as Fs } from "@effect/platform/FileSystem"
import type { Path as PathService } from "@effect/platform/Path"
import { Effect } from "effect"

import type { SessionsKillCommand, SessionsListCommand, SessionsLogsCommand } from "../core/domain.js"
import { runCommandCapture, runCommandWithExitCodes } from "../shell/command-runner.js"
import { readProjectConfig } from "../shell/config.js"
import type { ConfigDecodeError, ConfigNotFoundError } from "../shell/errors.js"
import { CommandFailedError } from "../shell/errors.js"
import { resolveBaseDir } from "../shell/paths.js"

type SessionsError = CommandFailedError | ConfigNotFoundError | ConfigDecodeError | PlatformError
type SessionsRequirements = Fs | PathService | CommandExecutor.CommandExecutor

const dockerOk = [0]
const baselineFile = "/run/docker-git/terminal-baseline.pids"

const buildFilteredPs = (mode: "tty" | "bg"): string =>
  `ps -eo pid,tty,etime,cmd --sort=etime | awk -v base="$BASELINE_FILE" -v mode="${mode}" 'BEGIN { while ((getline < base) > 0) baseline[$1]=1 } NR==1 {print; next} { pid=$1; tty=$2; cmd=$4; for (i=5;i<=NF;i++) cmd=cmd " " $i; if (baseline[pid]) next; if (cmd ~ /^sshd/ || cmd ~ /^-?bash/ || cmd ~ /^bash/ || cmd ~ /^sh/ || cmd ~ /^zsh/ || cmd ~ /^fish/ || cmd ~ /^ps / || cmd ~ /^awk / || cmd ~ /^grep / || cmd ~ /^tail / || cmd ~ /^who /) next; if (mode=="tty" && tty=="?") next; if (mode=="bg" && tty!="?") next; print; found=1 } END { if (!found) print "(none)" }'`

const makeDockerExecSpec = (containerName: string, args: ReadonlyArray<string>) => ({
  cwd: process.cwd(),
  command: "docker",
  args: ["exec", containerName, ...args]
})

const runDockerExecCapture = (
  containerName: string,
  args: ReadonlyArray<string>
): Effect.Effect<string, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandCapture(
    makeDockerExecSpec(containerName, args),
    dockerOk,
    (exitCode) => new CommandFailedError({ command: "docker exec", exitCode })
  )

const runDockerExec = (
  containerName: string,
  args: ReadonlyArray<string>
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandWithExitCodes(
    makeDockerExecSpec(containerName, args),
    dockerOk,
    (exitCode) => new CommandFailedError({ command: "docker exec", exitCode })
  )

const loadProjectContainer = (
  projectDir: string
): Effect.Effect<
  { readonly projectDir: string; readonly containerName: string },
  ConfigNotFoundError | ConfigDecodeError | PlatformError,
  Fs | PathService
> =>
  Effect.gen(function*(_) {
    const { resolved } = yield* _(resolveBaseDir(projectDir))
    const config = yield* _(readProjectConfig(resolved))
    return { projectDir: resolved, containerName: config.template.containerName }
  })

const loadAndLogContainer = (
  projectDir: string
): Effect.Effect<
  { readonly projectDir: string; readonly containerName: string },
  SessionsError,
  Fs | PathService
> =>
  Effect.gen(function*(_) {
    const info = yield* _(loadProjectContainer(projectDir))
    yield* _(Effect.log(`Project: ${info.projectDir}`))
    yield* _(Effect.log(`Container: ${info.containerName}`))
    return info
  })

const logCommandOutput = (output: string): Effect.Effect<void> =>
  output.trim().length === 0 ? Effect.log("(no output)") : Effect.log(output.trimEnd())

const runDockerExecCaptureLogged = (
  containerName: string,
  args: ReadonlyArray<string>
): Effect.Effect<void, SessionsError, CommandExecutor.CommandExecutor> =>
  Effect.flatMap(runDockerExecCapture(containerName, args), logCommandOutput)

const runSessionScript = (
  projectDir: string,
  args: ReadonlyArray<string>
): Effect.Effect<void, SessionsError, SessionsRequirements> =>
  Effect.gen(function*(_) {
    const { containerName } = yield* _(loadAndLogContainer(projectDir))
    yield* _(runDockerExecCaptureLogged(containerName, ["bash", "-lc", ...args]))
  })

// CHANGE: run terminal session scripts under bash
// WHY: Ubuntu /bin/sh (dash) fails on /etc/profile.d/zz-prompt.sh when run as a login shell
// QUOTE(ТЗ): "docker exec failed with exit code 2"
// REF: user-request-2026-02-05-sessions-bash
// SOURCE: n/a
// FORMAT THEOREM: ∀cmd: shell(cmd)=bash → compatible(cmd, /etc/profile.d/zz-prompt.sh)
// PURITY: SHELL
// EFFECT: Effect<void, SessionsError, CommandExecutor>
// INVARIANT: shell for scripts is deterministic (bash)
// COMPLEXITY: O(1)
const listSessionsScriptAll = [
  "echo \"TTY sessions (who -u)\"",
  "who -u 2>/dev/null || true",
  "echo \"\"",
  "echo \"TTY processes\"",
  "ps -eo pid,tty,etime,cmd --sort=etime | awk 'NR==1 {print; next} $2 != \"?\" {print; found=1} END { if (!found) print \"(none)\" }'",
  "echo \"\"",
  "echo \"Background processes (no TTY)\"",
  "ps -eo pid,tty,etime,cmd --sort=etime | awk 'NR==1 {print; next} $2 == \"?\" {print; found=1} END { if (!found) print \"(none)\" }'"
].join("; ")

// CHANGE: hide default/system processes from sessions list by default
// WHY: reduce noise from sshd/login shells and baseline tasks
// QUOTE(ТЗ): "Можно ли запомнить какие процессы изначально запущены и просто их не отображать как терминалы?"
// REF: user-request-2026-02-05-sessions-baseline
// SOURCE: n/a
// FORMAT THEOREM: ∀p: default(p) ∧ ¬includeDefault → hidden(p)
// PURITY: SHELL
// EFFECT: Effect<void, SessionsError, CommandExecutor>
// INVARIANT: includeDefault=true preserves full list
// COMPLEXITY: O(n) where n = number of processes
const buildListSessionsScript = (includeDefault: boolean): string => {
  if (includeDefault) {
    return listSessionsScriptAll
  }

  return [
    `BASELINE_FILE="${baselineFile}"`,
    "if [ ! -f \"$BASELINE_FILE\" ]; then BASELINE_FILE=\"/dev/null\"; fi",
    "echo \"TTY sessions (who -u)\"",
    "who -u 2>/dev/null || true",
    "echo \"\"",
    "echo \"TTY processes (user only)\"",
    buildFilteredPs("tty"),
    "echo \"\"",
    "echo \"Background processes (user only)\"",
    buildFilteredPs("bg")
  ].join("; ")
}

const logsScript = [
  "pid=\"$1\"",
  "lines=\"$2\"",
  "if [ -z \"$pid\" ]; then echo \"Missing pid\"; exit 2; fi",
  "if [ -z \"$lines\" ]; then lines=200; fi",
  "if [ ! -d \"/proc/$pid\" ]; then echo \"PID $pid not found\"; exit 3; fi",
  "resolve_log() {",
  "  for fd in 1 2; do",
  "    target=$(readlink -f \"/proc/$pid/fd/$fd\" 2>/dev/null || true)",
  "    if [ -n \"$target\" ] && [ -f \"$target\" ]; then",
  "      echo \"$target\"",
  "      return 0",
  "    fi",
  "  done",
  "  return 1",
  "}",
  "logfile=$(resolve_log || true)",
  "if [ -z \"$logfile\" ]; then",
  "  echo \"No file-backed stdout/stderr for PID $pid\"",
  "  exit 4",
  "fi",
  "echo \"Log file: $logfile\"",
  "tail -n \"$lines\" \"$logfile\" 2>&1"
].join("; ")

// CHANGE: list active terminal sessions inside a docker-git container
// WHY: expose container TTY/background processes from CLI
// QUOTE(ТЗ): "CLI команду которая из докера вернёт запущенные терминал сессии"
// REF: user-request-2026-02-04-terminal-sessions
// SOURCE: n/a
// FORMAT THEOREM: forall p: sessions(p) -> output(p)
// PURITY: SHELL
// EFFECT: Effect<void, SessionsError, FileSystem | Path | CommandExecutor>
// INVARIANT: project config resolves container name deterministically
// COMPLEXITY: O(n) where n = number of processes
export const listTerminalSessions = (
  command: SessionsListCommand
): Effect.Effect<void, SessionsError, SessionsRequirements> =>
  runSessionScript(command.projectDir, [buildListSessionsScript(command.includeDefault)])

// CHANGE: stop a background process inside a docker-git container
// WHY: allow shutting down long-running terminal jobs from CLI
// QUOTE(ТЗ): "иметь возможность его отключать"
// REF: user-request-2026-02-04-terminal-sessions
// SOURCE: n/a
// FORMAT THEOREM: forall pid: kill(pid) -> stopped(pid)
// PURITY: SHELL
// EFFECT: Effect<void, SessionsError, FileSystem | Path | CommandExecutor>
// INVARIANT: kill targets a single PID
// COMPLEXITY: O(1)
export const killTerminalProcess = (
  command: SessionsKillCommand
): Effect.Effect<void, SessionsError, SessionsRequirements> =>
  Effect.gen(function*(_) {
    const { containerName } = yield* _(loadAndLogContainer(command.projectDir))
    yield* _(runDockerExec(containerName, ["kill", "-TERM", String(command.pid)]))
    yield* _(Effect.log(`Sent SIGTERM to PID ${command.pid}`))
  })

// CHANGE: tail stdout/stderr logs for a container process
// WHY: expose background job logs without manual docker exec
// QUOTE(ТЗ): "иметь возможность его просматривать Что пишет он в терминал лог"
// REF: user-request-2026-02-04-terminal-sessions
// SOURCE: n/a
// FORMAT THEOREM: forall pid: logs(pid) -> output(pid)
// PURITY: SHELL
// EFFECT: Effect<void, SessionsError, FileSystem | Path | CommandExecutor>
// INVARIANT: uses file-backed stdout/stderr when present
// COMPLEXITY: O(n) where n = log lines
export const tailTerminalLogs = (
  command: SessionsLogsCommand
): Effect.Effect<void, SessionsError, SessionsRequirements> =>
  runSessionScript(command.projectDir, [
    logsScript,
    "--",
    String(command.pid),
    String(command.lines)
  ])
