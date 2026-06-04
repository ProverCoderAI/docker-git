// CHANGE: cover git wrapper post-push repo-context propagation
// WHY: `git -C <repo> push` must run session backup in the pushed repository, not the caller cwd
// REF: issue-201
// PURITY: SHELL (executes generated bash scripts in isolated temp directories)

import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect, pipe } from "effect"
import * as Chunk from "effect/Chunk"
import * as Stream from "effect/Stream"

import { renderEntrypointGitHooks } from "../../src/core/templates-entrypoint/git.js"
import { renderEntrypointGitPostPushWrapperInstall } from "../../src/core/templates-entrypoint/git-post-push-wrapper.js"

type WrapperHarness = {
  readonly repoDir: string
  readonly externalDir: string
  readonly binDir: string
  readonly wrapperPath: string
  readonly gitLogPath: string
  readonly nodeCwdLogPath: string
  readonly nodeRepoRootLogPath: string
  readonly nodeScriptLogPath: string
  readonly planToGitLogPath: string
}

const fakeGitScript = `#!/usr/bin/env bash
set -euo pipefail

if [[ -n "\${FAKE_GIT_LOG_PATH:-}" ]]; then
  printf '%s\\t%s\\n' "$PWD" "$*" >> "$FAKE_GIT_LOG_PATH"
fi

repo_dir="$PWD"
subcommand=""
args=("$@")
index=0

while [[ "$index" -lt "$#" ]]; do
  arg="\${args[$index]}"
  case "$arg" in
    -C)
      index=$((index + 1))
      if [[ "$index" -lt "$#" ]]; then
        repo_dir="\${args[$index]}"
      fi
      ;;
    -c|--git-dir|--work-tree|--namespace|--exec-path|--super-prefix|--config-env)
      index=$((index + 1))
      ;;
    --git-dir=*|--work-tree=*|--namespace=*|--exec-path=*|--super-prefix=*|--config-env=*|--bare|--no-pager|--paginate|--literal-pathspecs|--no-literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--no-optional-locks|--no-lazy-fetch)
      ;;
    --)
      break
      ;;
    -*)
      ;;
    *)
      subcommand="$arg"
      break
      ;;
  esac
  index=$((index + 1))
done

if [[ "$subcommand" == "rev-parse" ]]; then
  next_index=$((index + 1))
  if [[ "$next_index" -lt "$#" && "\${args[$next_index]}" == "--show-toplevel" ]]; then
    if [[ -d "$repo_dir/.git" || -f "$repo_dir/.git" ]]; then
      printf '%s\\n' "$repo_dir"
      exit 0
    fi
    exit 128
  fi
fi

if [[ "$subcommand" == "push" && -n "\${FAKE_GIT_PUSH_EXIT_CODE:-}" ]]; then
  exit "$FAKE_GIT_PUSH_EXIT_CODE"
fi

exit 0
`

const fakeSessionSyncScript = `#!/usr/bin/env bash
set -euo pipefail

if [[ -n "\${FAKE_NODE_CWD_LOG_PATH:-}" ]]; then
  printf '%s\\n' "$PWD" >> "$FAKE_NODE_CWD_LOG_PATH"
fi
if [[ -n "\${FAKE_NODE_REPO_ROOT_LOG_PATH:-}" ]]; then
  printf '%s\\n' "\${DOCKER_GIT_POST_PUSH_REPO_ROOT:-}" >> "$FAKE_NODE_REPO_ROOT_LOG_PATH"
fi
if [[ -n "\${FAKE_NODE_SCRIPT_LOG_PATH:-}" ]]; then
  printf '%s\\n' "$*" >> "$FAKE_NODE_SCRIPT_LOG_PATH"
fi

if [[ -n "\${FAKE_SESSION_SYNC_EXIT_CODE:-}" ]]; then
  exit "$FAKE_SESSION_SYNC_EXIT_CODE"
fi

exit 0
`

const fakeGhScript = `#!/usr/bin/env bash
set -euo pipefail
exit 0
`

const fakePlanToGitScript = `#!/usr/bin/env bash
set -euo pipefail

if [[ -n "\${FAKE_PLAN_TO_GIT_LOG_PATH:-}" ]]; then
  printf '%s\\t%s\\n' "$PWD" "$*" >> "$FAKE_PLAN_TO_GIT_LOG_PATH"
fi

if [[ -n "\${FAKE_PLAN_TO_GIT_EXIT_CODE:-}" ]]; then
  exit "$FAKE_PLAN_TO_GIT_EXIT_CODE"
fi

exit 0
`

const collectUint8Array = (chunks: Chunk.Chunk<Uint8Array>): Uint8Array =>
  Chunk.reduce(chunks, new Uint8Array(), (acc, curr) => {
    const next = new Uint8Array(acc.length + curr.length)
    next.set(acc)
    next.set(curr, acc.length)
    return next
  })

const extractEmbeddedScript = (template: string, target: string): string => {
  const marker = `cat <<'EOF' > "${target}"\n`
  const start = template.indexOf(marker)
  if (start < 0) {
    throw new Error(`script marker not found: ${target}`)
  }

  const bodyStart = start + marker.length
  const bodyEnd = template.indexOf("\nEOF", bodyStart)
  if (bodyEnd < 0) {
    throw new Error(`script terminator not found: ${target}`)
  }

  return template.slice(bodyStart, bodyEnd)
}

const writeExecutable = (
  filePath: string,
  content: string
): Effect.Effect<void, Error, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    yield* _(fs.makeDirectory(path.dirname(filePath), { recursive: true }))
    yield* _(fs.writeFileString(filePath, content))
    yield* _(fs.chmod(filePath, 0o755))
  })

const readLogLines = (
  filePath: string
): Effect.Effect<ReadonlyArray<string>, Error, FileSystem.FileSystem> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const exists = yield* _(fs.exists(filePath))
    if (!exists) {
      return []
    }

    const contents = yield* _(fs.readFileString(filePath))
    const trimmed = contents.trim()
    return trimmed.length === 0 ? [] : trimmed.split("\n")
  })

const runCommand = (
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
  env?: Readonly<Record<string, string | undefined>>,
  okExitCodes: ReadonlyArray<number> = [0]
): Effect.Effect<string, Error, CommandExecutor.CommandExecutor> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const executor = yield* _(CommandExecutor.CommandExecutor)
      const cmd = pipe(
        Command.make(command, ...args),
        Command.workingDirectory(cwd),
        env ? Command.env(env) : (value) => value,
        Command.stdout("pipe"),
        Command.stderr("pipe"),
        Command.stdin("pipe")
      )
      const proc = yield* _(executor.start(cmd))
      yield* _(Effect.forkDaemon(Stream.runDrain(proc.stderr)))
      const stdoutBytes = yield* _(
        pipe(proc.stdout, Stream.runCollect, Effect.map((chunks) => collectUint8Array(chunks)))
      )
      const exitCode = yield* _(proc.exitCode)
      const numericExitCode = Number(exitCode)
      if (!okExitCodes.includes(numericExitCode)) {
        return yield* _(Effect.fail(new Error(`${command} ${args.join(" ")} exited with ${String(exitCode)}`)))
      }

      return new TextDecoder("utf-8").decode(stdoutBytes).trim()
    })
  )

const makeHarnessEnv = (
  harness: WrapperHarness,
  overrides: Readonly<Record<string, string | undefined>> = {}
): Readonly<Record<string, string | undefined>> => ({
  ...process.env,
  PATH: `${harness.binDir}:${process.env["PATH"] ?? ""}`,
  FAKE_GIT_LOG_PATH: harness.gitLogPath,
  FAKE_NODE_CWD_LOG_PATH: harness.nodeCwdLogPath,
  FAKE_NODE_REPO_ROOT_LOG_PATH: harness.nodeRepoRootLogPath,
  FAKE_NODE_SCRIPT_LOG_PATH: harness.nodeScriptLogPath,
  FAKE_PLAN_TO_GIT_LOG_PATH: harness.planToGitLogPath,
  ...overrides
})

const runWrapper = (
  harness: WrapperHarness,
  cwd: string,
  args: ReadonlyArray<string>,
  options: {
    readonly env?: Readonly<Record<string, string | undefined>>
    readonly okExitCodes?: ReadonlyArray<number>
  } = {}
): Effect.Effect<void, Error, CommandExecutor.CommandExecutor> =>
  runCommand(
    harness.wrapperPath,
    args,
    cwd,
    makeHarnessEnv(harness, options.env),
    options.okExitCodes
  ).pipe(Effect.asVoid)

const withHarness = <A, E, R>(
  use: (harness: WrapperHarness) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem | Path.Path> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const path = yield* _(Path.Path)
      const rootDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-post-push-"
        })
      )

      const repoDir = path.join(rootDir, "repo")
      const externalDir = path.join(rootDir, "external")
      const binDir = path.join(rootDir, "bin")
      const hooksDir = path.join(rootDir, "hooks")
      const gitLogPath = path.join(rootDir, "git.log")
      const nodeCwdLogPath = path.join(rootDir, "node-cwd.log")
      const nodeRepoRootLogPath = path.join(rootDir, "node-repo-root.log")
      const nodeScriptLogPath = path.join(rootDir, "node-script.log")
      const planToGitLogPath = path.join(rootDir, "plan-to-git.log")

      yield* _(fs.makeDirectory(path.join(repoDir, ".git"), { recursive: true }))
      yield* _(fs.makeDirectory(externalDir, { recursive: true }))
      yield* _(fs.makeDirectory(binDir, { recursive: true }))
      yield* _(fs.makeDirectory(hooksDir, { recursive: true }))

      yield* _(writeExecutable(path.join(binDir, "git"), fakeGitScript))
      yield* _(writeExecutable(path.join(binDir, "git-real"), fakeGitScript))
      yield* _(writeExecutable(path.join(binDir, "gh"), fakeGhScript))
      yield* _(writeExecutable(path.join(binDir, "docker-git-session-sync"), fakeSessionSyncScript))
      yield* _(writeExecutable(path.join(binDir, "plan-to-git"), fakePlanToGitScript))

      const postPushScript = extractEmbeddedScript(renderEntrypointGitHooks(), "$POST_PUSH_ACTION")
      const postPushPath = path.join(hooksDir, "post-push")
      yield* _(writeExecutable(postPushPath, postPushScript))

      const wrapperTemplate = extractEmbeddedScript(
        renderEntrypointGitPostPushWrapperInstall(),
        "$GIT_WRAPPER_BIN"
      )
      const wrapperPath = path.join(rootDir, "git-wrapper")
      const wrapperScript = wrapperTemplate
        .replace("__DOCKER_GIT_REAL_BIN__", path.join(binDir, "git-real"))
        .replace("/opt/docker-git/hooks/post-push", postPushPath)
      yield* _(writeExecutable(wrapperPath, wrapperScript))

      return yield* _(
        use({
          repoDir,
          externalDir,
          binDir,
          wrapperPath,
          gitLogPath,
          nodeCwdLogPath,
          nodeRepoRootLogPath,
          nodeScriptLogPath,
          planToGitLogPath
        })
      )
    })
  )

describe("git post-push wrapper", () => {
  it.effect("runs session backup from the repository root for a normal push", () =>
    withHarness((harness) =>
      Effect.gen(function*(_) {
        yield* _(runWrapper(harness, harness.repoDir, ["push", "origin", "HEAD"]))

        const nodeCwd = yield* _(readLogLines(harness.nodeCwdLogPath))
        const nodeRepoRoot = yield* _(readLogLines(harness.nodeRepoRootLogPath))
        const nodeScript = yield* _(readLogLines(harness.nodeScriptLogPath))
        const planToGit = yield* _(readLogLines(harness.planToGitLogPath))

        expect(nodeCwd).toEqual([harness.repoDir])
        expect(nodeRepoRoot).toEqual([harness.repoDir])
        expect(nodeScript).toEqual(["backup --verbose --background --require-comment"])
        expect(planToGit).toEqual([`${harness.repoDir}\tsync`])
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("preserves the pushed repository context for git -C push invocations", () =>
    withHarness((harness) =>
      Effect.gen(function*(_) {
        yield* _(runWrapper(harness, harness.externalDir, ["-C", harness.repoDir, "push", "origin", "HEAD"]))

        const nodeCwd = yield* _(readLogLines(harness.nodeCwdLogPath))
        const nodeRepoRoot = yield* _(readLogLines(harness.nodeRepoRootLogPath))
        const nodeScript = yield* _(readLogLines(harness.nodeScriptLogPath))
        const gitLog = yield* _(readLogLines(harness.gitLogPath))
        const planToGit = yield* _(readLogLines(harness.planToGitLogPath))

        expect(nodeCwd).toEqual([harness.repoDir])
        expect(nodeRepoRoot).toEqual([harness.repoDir])
        expect(nodeScript).toEqual(["backup --verbose --background --require-comment"])
        expect(planToGit).toEqual([`${harness.repoDir}\tsync`])
        expect(gitLog.some((line) => line.startsWith(`${harness.externalDir}\t-C ${harness.repoDir} push`))).toBe(true)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("does not run session backup for dry-run push variants", () =>
    withHarness((harness) =>
      Effect.gen(function*(_) {
        yield* _(runWrapper(harness, harness.externalDir, ["-C", harness.repoDir, "push", "--dry-run", "origin", "HEAD"]))
        yield* _(runWrapper(harness, harness.externalDir, ["-C", harness.repoDir, "push", "-n", "origin", "HEAD"]))

        const nodeCwd = yield* _(readLogLines(harness.nodeCwdLogPath))
        const nodeRepoRoot = yield* _(readLogLines(harness.nodeRepoRootLogPath))
        const nodeScript = yield* _(readLogLines(harness.nodeScriptLogPath))
        const planToGit = yield* _(readLogLines(harness.planToGitLogPath))

        expect(nodeCwd).toEqual([])
        expect(nodeRepoRoot).toEqual([])
        expect(nodeScript).toEqual([])
        expect(planToGit).toEqual([])
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("does not run session backup when git push fails", () =>
    withHarness((harness) =>
      Effect.gen(function*(_) {
        yield* _(
          runWrapper(
            harness,
            harness.externalDir,
            ["-C", harness.repoDir, "push", "origin", "HEAD"],
            {
              env: { FAKE_GIT_PUSH_EXIT_CODE: "1" },
              okExitCodes: [1]
            }
          )
        )

        const nodeCwd = yield* _(readLogLines(harness.nodeCwdLogPath))
        const nodeRepoRoot = yield* _(readLogLines(harness.nodeRepoRootLogPath))
        const nodeScript = yield* _(readLogLines(harness.nodeScriptLogPath))
        const planToGit = yield* _(readLogLines(harness.planToGitLogPath))

        expect(nodeCwd).toEqual([])
        expect(nodeRepoRoot).toEqual([])
        expect(nodeScript).toEqual([])
        expect(planToGit).toEqual([])
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("skips plan sync when disabled but still runs session backup", () =>
    withHarness((harness) =>
      Effect.gen(function*(_) {
        yield* _(
          runWrapper(harness, harness.repoDir, ["push", "origin", "HEAD"], {
            env: { DOCKER_GIT_SKIP_PLAN_TO_GIT: "1" }
          })
        )

        const nodeScript = yield* _(readLogLines(harness.nodeScriptLogPath))
        const planToGit = yield* _(readLogLines(harness.planToGitLogPath))

        expect(nodeScript).toEqual(["backup --verbose --background --require-comment"])
        expect(planToGit).toEqual([])
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("propagates plan sync failures before session backup", () =>
    withHarness((harness) =>
      Effect.gen(function*(_) {
        yield* _(
          runWrapper(harness, harness.repoDir, ["push", "origin", "HEAD"], {
            env: { FAKE_PLAN_TO_GIT_EXIT_CODE: "37" },
            okExitCodes: [37]
          })
        )

        const nodeScript = yield* _(readLogLines(harness.nodeScriptLogPath))
        const planToGit = yield* _(readLogLines(harness.planToGitLogPath))

        expect(nodeScript).toEqual([])
        expect(planToGit).toEqual([`${harness.repoDir}\tsync`])
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("propagates post-push failures after a successful push", () =>
    withHarness((harness) =>
      Effect.gen(function*(_) {
        yield* _(
          runWrapper(harness, harness.repoDir, ["push", "origin", "HEAD"], {
            env: { FAKE_SESSION_SYNC_EXIT_CODE: "23" },
            okExitCodes: [23]
          })
        )

        const nodeScript = yield* _(readLogLines(harness.nodeScriptLogPath))
        const planToGit = yield* _(readLogLines(harness.planToGitLogPath))

        expect(nodeScript).toEqual(["backup --verbose --background --require-comment"])
        expect(planToGit).toEqual([`${harness.repoDir}\tsync`])
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
