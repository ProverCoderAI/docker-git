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
  readonly planToGitSyncHelperPath: string
  readonly gitLogPath: string
  readonly nodeCwdLogPath: string
  readonly nodeRepoRootLogPath: string
  readonly nodeScriptLogPath: string
  readonly planToGitLogPath: string
  readonly ghLogPath: string
}

const expectedPlanToGitRuns = (
  repoDir: string,
  commands: ReadonlyArray<string>,
  targetRepo = "org/repo"
): ReadonlyArray<string> =>
  commands.flatMap((command) => [`${repoDir}\ttarget-repo:${targetRepo}`, `${repoDir}\t${command}`])

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
  next_next_index=$((index + 2))
  if [[ "$next_index" -lt "$#" && "$next_next_index" -lt "$#" && "\${args[$next_index]}" == "--abbrev-ref" && "\${args[$next_next_index]}" == "HEAD" ]]; then
    printf '%s\\n' "\${FAKE_GIT_BRANCH:-issue-375}"
    exit 0
  fi
fi

if [[ "$subcommand" == "remote" ]]; then
  next_index=$((index + 1))
  next_next_index=$((index + 2))
  if [[ "$next_index" -lt "$#" && "$next_next_index" -lt "$#" && "\${args[$next_index]}" == "get-url" ]]; then
    remote_name="\${args[$next_next_index]}"
    if [[ "$remote_name" == "upstream" && -n "\${FAKE_GIT_UPSTREAM_URL:-}" ]]; then
      printf '%s\\n' "$FAKE_GIT_UPSTREAM_URL"
      exit 0
    fi
    if [[ "$remote_name" == "origin" ]]; then
      printf '%s\\n' "\${FAKE_GIT_ORIGIN_URL:-https://github.com/org/repo.git}"
      exit 0
    fi
    exit 2
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

if [[ -n "\${FAKE_GH_LOG_PATH:-}" ]]; then
  printf '%s\\t%s\\n' "$PWD" "$*" >> "$FAKE_GH_LOG_PATH"
fi

if [[ "\${1:-}" == "repo" && "\${2:-}" == "view" ]]; then
  if [[ -n "\${FAKE_GH_REPO_VIEW_EXIT_CODE:-}" ]]; then
    exit "$FAKE_GH_REPO_VIEW_EXIT_CODE"
  fi
  printf '%s\\n' "\${FAKE_GH_DEFAULT_BRANCH:-main}"
  exit 0
fi

if [[ "\${1:-}" == "pr" && "\${2:-}" == "list" ]]; then
  if [[ -n "\${FAKE_GH_PR_LIST_EXIT_CODE:-}" ]]; then
    exit "$FAKE_GH_PR_LIST_EXIT_CODE"
  fi
  if [[ -n "\${FAKE_GH_OPEN_PR_URL:-}" ]]; then
    printf '%s\\n' "$FAKE_GH_OPEN_PR_URL"
  fi
  exit 0
fi

if [[ "\${1:-}" == "pr" && "\${2:-}" == "create" ]]; then
  if [[ -n "\${FAKE_GH_PR_CREATE_EXIT_CODE:-}" ]]; then
    exit "$FAKE_GH_PR_CREATE_EXIT_CODE"
  fi
  printf '%s\\n' "\${FAKE_GH_CREATED_PR_URL:-https://github.com/org/repo/pull/375}"
  exit 0
fi

exit 0
`

const fakePlanToGitScript = `#!/usr/bin/env bash
set -euo pipefail

if [[ "\${1:-}" == "sync" && "\${2:-}" == "--help" ]]; then
  printf '%s\\n' "--pr <PR>"
  exit 0
fi

if [[ -n "\${FAKE_PLAN_TO_GIT_LOG_PATH:-}" ]]; then
  if [[ -n "\${PLAN_TO_GIT_REPO:-}" ]]; then
    printf '%s\\ttarget-repo:%s\\n' "$PWD" "$PLAN_TO_GIT_REPO" >> "$FAKE_PLAN_TO_GIT_LOG_PATH"
  fi
  printf '%s\\t%s\\n' "$PWD" "$*" >> "$FAKE_PLAN_TO_GIT_LOG_PATH"
fi

if [[ "\${1:-}" != "import-codex" && "\${1:-}" != "import-claude" && "\${1:-}" != "sync" && "\${1:-}" != "hook" ]]; then
  if [[ -n "\${FAKE_PLAN_TO_GIT_LOG_PATH:-}" ]]; then
    printf '%s\\tunexpected-command:%s\\n' "$PWD" "\${1:-<empty>}" >> "$FAKE_PLAN_TO_GIT_LOG_PATH"
  fi
  echo "fakePlanToGit: expected import-codex, import-claude, hook, or sync command, got: \${1:-<empty>}" >&2
  exit 127
fi

if [[ "\${1:-}" == "sync" && "\${2:-}" == "--pr" && -n "\${FAKE_PLAN_TO_GIT_EXPECT_TARGET_REPO:-}" ]]; then
  if [[ "\${PLAN_TO_GIT_REPO:-}" != "$FAKE_PLAN_TO_GIT_EXPECT_TARGET_REPO" ]]; then
    echo "fakePlanToGit: expected target repo $FAKE_PLAN_TO_GIT_EXPECT_TARGET_REPO, got \${PLAN_TO_GIT_REPO:-<unset>}" >&2
    exit 44
  fi
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
  FAKE_GH_LOG_PATH: harness.ghLogPath,
  DOCKER_GIT_PLAN_TO_GIT_SYNC_HELPER: harness.planToGitSyncHelperPath,
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
      const ghLogPath = path.join(rootDir, "gh.log")

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

      const planToGitSyncHelperScript = extractEmbeddedScript(renderEntrypointGitHooks(), "$PLAN_TO_GIT_SYNC_HELPER")
      const planToGitSyncHelperPath = path.join(hooksDir, "plan-to-git-sync")
      yield* _(writeExecutable(planToGitSyncHelperPath, planToGitSyncHelperScript))

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
          planToGitSyncHelperPath,
          gitLogPath,
          nodeCwdLogPath,
          nodeRepoRootLogPath,
          nodeScriptLogPath,
          planToGitLogPath,
          ghLogPath
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
        const gh = yield* _(readLogLines(harness.ghLogPath))

        expect(nodeCwd).toEqual([harness.repoDir])
        expect(nodeRepoRoot).toEqual([harness.repoDir])
        expect(nodeScript).toEqual(["backup --verbose --background --require-comment"])
        expect(planToGit).toEqual(
          expectedPlanToGitRuns(harness.repoDir, ["import-codex --no-sync", "import-claude --no-sync", "sync"])
        )
        expect(gh).toContain(`${harness.repoDir}\tpr create --repo org/repo --base main --head issue-375 --fill`)
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
        const gh = yield* _(readLogLines(harness.ghLogPath))

        expect(nodeCwd).toEqual([harness.repoDir])
        expect(nodeRepoRoot).toEqual([harness.repoDir])
        expect(nodeScript).toEqual(["backup --verbose --background --require-comment"])
        expect(planToGit).toEqual(
          expectedPlanToGitRuns(harness.repoDir, ["import-codex --no-sync", "import-claude --no-sync", "sync"])
        )
        expect(gh).toContain(`${harness.repoDir}\tpr create --repo org/repo --base main --head issue-375 --fill`)
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
        const gh = yield* _(readLogLines(harness.ghLogPath))

        expect(nodeCwd).toEqual([])
        expect(nodeRepoRoot).toEqual([])
        expect(nodeScript).toEqual([])
        expect(planToGit).toEqual([])
        expect(gh).toEqual([])
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
        const gh = yield* _(readLogLines(harness.ghLogPath))

        expect(nodeCwd).toEqual([])
        expect(nodeRepoRoot).toEqual([])
        expect(nodeScript).toEqual([])
        expect(planToGit).toEqual([])
        expect(gh).toEqual([])
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("skips plan sync when disabled but still ensures a PR and runs session backup", () =>
    withHarness((harness) =>
      Effect.gen(function*(_) {
        yield* _(
          runWrapper(harness, harness.repoDir, ["push", "origin", "HEAD"], {
            env: { DOCKER_GIT_SKIP_PLAN_TO_GIT: "1" }
          })
        )

        const nodeScript = yield* _(readLogLines(harness.nodeScriptLogPath))
        const planToGit = yield* _(readLogLines(harness.planToGitLogPath))
        const gh = yield* _(readLogLines(harness.ghLogPath))

        expect(nodeScript).toEqual(["backup --verbose --background --require-comment"])
        expect(planToGit).toEqual([])
        expect(gh).toContain(`${harness.repoDir}\tpr create --repo org/repo --base main --head issue-375 --fill`)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("propagates plan import failures after ensuring a PR and before session backup", () =>
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
        const gh = yield* _(readLogLines(harness.ghLogPath))

        expect(nodeScript).toEqual([])
        expect(planToGit).toEqual(expectedPlanToGitRuns(harness.repoDir, ["import-codex --no-sync"]))
        expect(gh).toContain(`${harness.repoDir}\tpr create --repo org/repo --base main --head issue-375 --fill`)
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
        expect(planToGit).toEqual(
          expectedPlanToGitRuns(harness.repoDir, ["import-codex --no-sync", "import-claude --no-sync", "sync"])
        )
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("reuses an existing open PR instead of creating a duplicate", () =>
    withHarness((harness) =>
      Effect.gen(function*(_) {
        yield* _(
          runWrapper(harness, harness.repoDir, ["push", "origin", "HEAD"], {
            env: { FAKE_GH_OPEN_PR_URL: "https://github.com/org/repo/pull/375" }
          })
        )

        const nodeScript = yield* _(readLogLines(harness.nodeScriptLogPath))
        const planToGit = yield* _(readLogLines(harness.planToGitLogPath))
        const gh = yield* _(readLogLines(harness.ghLogPath))

        expect(nodeScript).toEqual(["backup --verbose --background --require-comment"])
        expect(planToGit).toEqual(
          expectedPlanToGitRuns(harness.repoDir, ["import-codex --no-sync", "import-claude --no-sync", "sync"])
        )
        expect(gh).toContain(`${harness.repoDir}\tpr list --repo org/repo --state open --head issue-375 --json url --jq .[0].url // ""`)
        expect(gh.some((line) => line.includes("pr create"))).toBe(false)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("creates fork PRs against upstream with an owner-qualified head branch", () =>
    withHarness((harness) =>
      Effect.gen(function*(_) {
        yield* _(
          runWrapper(harness, harness.repoDir, ["push", "origin", "HEAD"], {
            env: {
              FAKE_GIT_ORIGIN_URL: "https://github.com/me/repo.git",
              FAKE_GIT_UPSTREAM_URL: "https://github.com/org/repo.git"
            }
          })
        )

        const gh = yield* _(readLogLines(harness.ghLogPath))

        expect(gh).toContain(`${harness.repoDir}\trepo view org/repo --json defaultBranchRef --jq .defaultBranchRef.name`)
        expect(gh).toContain(`${harness.repoDir}\tpr list --repo org/repo --state open --head me:issue-375 --json url --jq .[0].url // ""`)
        expect(gh).toContain(`${harness.repoDir}\tpr list --repo org/repo --state open --head issue-375 --json url --jq .[0].url // ""`)
        expect(gh).toContain(`${harness.repoDir}\tpr create --repo org/repo --base main --head me:issue-375 --fill`)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("syncs explicit PR plans against upstream target repo when origin is a fork", () =>
    withHarness((harness) =>
      Effect.gen(function*(_) {
        yield* _(
          runWrapper(harness, harness.repoDir, ["push", "origin", "HEAD"], {
            env: {
              DOCKER_GIT_PR_NUMBER: "375",
              FAKE_GH_OPEN_PR_URL: "https://github.com/org/repo/pull/375",
              FAKE_GIT_ORIGIN_URL: "https://github.com/me/repo.git",
              FAKE_GIT_UPSTREAM_URL: "https://github.com/org/repo.git",
              FAKE_PLAN_TO_GIT_EXPECT_TARGET_REPO: "org/repo"
            }
          })
        )

        const nodeScript = yield* _(readLogLines(harness.nodeScriptLogPath))
        const planToGit = yield* _(readLogLines(harness.planToGitLogPath))
        const gh = yield* _(readLogLines(harness.ghLogPath))

        expect(nodeScript).toEqual(["backup --verbose --background --require-comment"])
        expect(planToGit).toEqual(
          expectedPlanToGitRuns(harness.repoDir, ["import-codex --no-sync", "import-claude --no-sync", "sync --pr 375"])
        )
        expect(gh).toContain(`${harness.repoDir}\tpr list --repo org/repo --state open --head me:issue-375 --json url --jq .[0].url // ""`)
        expect(gh.some((line) => line.includes("pr create"))).toBe(false)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("propagates PR creation failures before plan sync and session backup", () =>
    withHarness((harness) =>
      Effect.gen(function*(_) {
        yield* _(
          runWrapper(harness, harness.repoDir, ["push", "origin", "HEAD"], {
            env: { FAKE_GH_PR_CREATE_EXIT_CODE: "41" },
            okExitCodes: [41]
          })
        )

        const nodeScript = yield* _(readLogLines(harness.nodeScriptLogPath))
        const planToGit = yield* _(readLogLines(harness.planToGitLogPath))
        const gh = yield* _(readLogLines(harness.ghLogPath))

        expect(nodeScript).toEqual([])
        expect(planToGit).toEqual([])
        expect(gh).toContain(`${harness.repoDir}\tpr create --repo org/repo --base main --head issue-375 --fill`)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("propagates PR list failures without creating a duplicate PR", () =>
    withHarness((harness) =>
      Effect.gen(function*(_) {
        yield* _(
          runWrapper(harness, harness.repoDir, ["push", "origin", "HEAD"], {
            env: { FAKE_GH_PR_LIST_EXIT_CODE: "42" },
            okExitCodes: [1]
          })
        )

        const nodeScript = yield* _(readLogLines(harness.nodeScriptLogPath))
        const planToGit = yield* _(readLogLines(harness.planToGitLogPath))
        const gh = yield* _(readLogLines(harness.ghLogPath))

        expect(nodeScript).toEqual([])
        expect(planToGit).toEqual([])
        expect(gh).toContain(`${harness.repoDir}\tpr list --repo org/repo --state open --head issue-375 --json url --jq .[0].url // ""`)
        expect(gh.some((line) => line.includes("pr create"))).toBe(false)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("fails on detached HEAD before listing or creating PRs", () =>
    withHarness((harness) =>
      Effect.gen(function*(_) {
        yield* _(
          runWrapper(harness, harness.repoDir, ["push", "origin", "HEAD"], {
            env: { FAKE_GIT_BRANCH: "HEAD" },
            okExitCodes: [1]
          })
        )

        const nodeScript = yield* _(readLogLines(harness.nodeScriptLogPath))
        const planToGit = yield* _(readLogLines(harness.planToGitLogPath))
        const gh = yield* _(readLogLines(harness.ghLogPath))

        expect(nodeScript).toEqual([])
        expect(planToGit).toEqual([])
        expect(gh).toEqual([])
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
