// CHANGE: cover git wrapper post-push repo-context propagation
// WHY: `git -C <repo> push` must run session backup in the pushed repository, not the caller cwd
// REF: issue-201
// PURITY: SHELL (executes generated bash scripts in isolated temp directories)

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { renderEntrypointGitHooks } from "../../src/core/templates-entrypoint/git.js"
import { renderEntrypointGitPostPushWrapperInstall } from "../../src/core/templates-entrypoint/git-post-push-wrapper.js"

type WrapperHarness = {
  readonly rootDir: string
  readonly repoDir: string
  readonly externalDir: string
  readonly binDir: string
  readonly wrapperPath: string
  readonly gitLogPath: string
  readonly nodeCwdLogPath: string
  readonly nodeRepoRootLogPath: string
  readonly nodeScriptLogPath: string
}

const tempRoots: string[] = []

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

exit 0
`

const fakeNodeScript = `#!/usr/bin/env bash
set -euo pipefail

if [[ -n "\${FAKE_NODE_CWD_LOG_PATH:-}" ]]; then
  printf '%s\\n' "$PWD" >> "$FAKE_NODE_CWD_LOG_PATH"
fi
if [[ -n "\${FAKE_NODE_REPO_ROOT_LOG_PATH:-}" ]]; then
  printf '%s\\n' "\${DOCKER_GIT_POST_PUSH_REPO_ROOT:-}" >> "$FAKE_NODE_REPO_ROOT_LOG_PATH"
fi
if [[ -n "\${FAKE_NODE_SCRIPT_LOG_PATH:-}" ]]; then
  printf '%s\\n' "$1" >> "$FAKE_NODE_SCRIPT_LOG_PATH"
fi

exit 0
`

const fakeGhScript = `#!/usr/bin/env bash
set -euo pipefail
exit 0
`

const writeExecutable = (filePath: string, content: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
  fs.chmodSync(filePath, 0o755)
}

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

const readLogLines = (filePath: string): ReadonlyArray<string> => {
  if (!fs.existsSync(filePath)) {
    return []
  }

  const contents = fs.readFileSync(filePath, "utf8").trim()
  return contents.length === 0 ? [] : contents.split("\n")
}

const makeHarness = (): WrapperHarness => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "docker-git-post-push-"))
  tempRoots.push(rootDir)

  const repoDir = path.join(rootDir, "repo")
  const externalDir = path.join(rootDir, "external")
  const binDir = path.join(rootDir, "bin")
  const hooksDir = path.join(rootDir, "hooks")
  const gitLogPath = path.join(rootDir, "git.log")
  const nodeCwdLogPath = path.join(rootDir, "node-cwd.log")
  const nodeRepoRootLogPath = path.join(rootDir, "node-repo-root.log")
  const nodeScriptLogPath = path.join(rootDir, "node-script.log")

  fs.mkdirSync(path.join(repoDir, ".git"), { recursive: true })
  fs.mkdirSync(path.join(repoDir, "scripts"), { recursive: true })
  fs.mkdirSync(externalDir, { recursive: true })
  fs.mkdirSync(binDir, { recursive: true })
  fs.mkdirSync(hooksDir, { recursive: true })
  fs.writeFileSync(path.join(repoDir, "scripts", "session-backup-gist.js"), "// test placeholder\n")

  writeExecutable(path.join(binDir, "git"), fakeGitScript)
  writeExecutable(path.join(binDir, "git-real"), fakeGitScript)
  writeExecutable(path.join(binDir, "gh"), fakeGhScript)
  writeExecutable(path.join(binDir, "node"), fakeNodeScript)

  const postPushScript = extractEmbeddedScript(renderEntrypointGitHooks(), "$POST_PUSH_ACTION")
  const postPushPath = path.join(hooksDir, "post-push")
  writeExecutable(postPushPath, postPushScript)

  const wrapperTemplate = extractEmbeddedScript(
    renderEntrypointGitPostPushWrapperInstall(),
    "$GIT_WRAPPER_BIN"
  )
  const wrapperPath = path.join(rootDir, "git-wrapper")
  const wrapperScript = wrapperTemplate
    .replace("__DOCKER_GIT_REAL_BIN__", path.join(binDir, "git-real"))
    .replace("/opt/docker-git/hooks/post-push", postPushPath)
  writeExecutable(wrapperPath, wrapperScript)

  return {
    rootDir,
    repoDir,
    externalDir,
    binDir,
    wrapperPath,
    gitLogPath,
    nodeCwdLogPath,
    nodeRepoRootLogPath,
    nodeScriptLogPath
  }
}

const makeHarnessEnv = (harness: WrapperHarness): NodeJS.ProcessEnv => ({
  ...process.env,
  PATH: `${harness.binDir}:${process.env["PATH"] ?? ""}`,
  FAKE_GIT_LOG_PATH: harness.gitLogPath,
  FAKE_NODE_CWD_LOG_PATH: harness.nodeCwdLogPath,
  FAKE_NODE_REPO_ROOT_LOG_PATH: harness.nodeRepoRootLogPath,
  FAKE_NODE_SCRIPT_LOG_PATH: harness.nodeScriptLogPath
})

const runWrapper = (
  harness: WrapperHarness,
  cwd: string,
  args: ReadonlyArray<string>
): void => {
  execFileSync(harness.wrapperPath, args, {
    cwd,
    env: makeHarnessEnv(harness),
    encoding: "utf8",
    stdio: "pipe"
  })
}

describe("git post-push wrapper", () => {
  afterEach(() => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop()
      if (root !== undefined) {
        fs.rmSync(root, { recursive: true, force: true })
      }
    }
  })

  it("runs session backup from the repository root for a normal push", () => {
    const harness = makeHarness()

    runWrapper(harness, harness.repoDir, ["push", "origin", "HEAD"])

    expect(readLogLines(harness.nodeCwdLogPath)).toEqual([harness.repoDir])
    expect(readLogLines(harness.nodeRepoRootLogPath)).toEqual([harness.repoDir])
    expect(readLogLines(harness.nodeScriptLogPath)).toEqual([
      path.join(harness.repoDir, "scripts", "session-backup-gist.js")
    ])
  })

  it("preserves the pushed repository context for git -C push invocations", () => {
    const harness = makeHarness()

    runWrapper(harness, harness.externalDir, ["-C", harness.repoDir, "push", "origin", "HEAD"])

    expect(readLogLines(harness.nodeCwdLogPath)).toEqual([harness.repoDir])
    expect(readLogLines(harness.nodeRepoRootLogPath)).toEqual([harness.repoDir])
    expect(readLogLines(harness.nodeScriptLogPath)).toEqual([
      path.join(harness.repoDir, "scripts", "session-backup-gist.js")
    ])
    expect(readLogLines(harness.gitLogPath).some((line) => line.startsWith(`${harness.externalDir}\t-C ${harness.repoDir} push`))).toBe(
      true
    )
  })

  it.each([
    ["--dry-run"],
    ["-n"]
  ])("does not run session backup for dry-run push (%s)", (dryRunFlag) => {
    const harness = makeHarness()

    runWrapper(harness, harness.externalDir, ["-C", harness.repoDir, "push", dryRunFlag, "origin", "HEAD"])

    expect(readLogLines(harness.nodeCwdLogPath)).toEqual([])
    expect(readLogLines(harness.nodeRepoRootLogPath)).toEqual([])
    expect(readLogLines(harness.nodeScriptLogPath)).toEqual([])
  })
})
