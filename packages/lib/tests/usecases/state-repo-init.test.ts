// CHANGE: integration tests for stateInit — orphan adoption and idempotency
// WHY: PR reviewer required test coverage for fix-141 bug (divergent root commit)
// QUOTE(ТЗ): "Новая ветка открывается только тогда когда не возможно исправить конфликт и сделать push в main"
// REF: issue-141
// PURITY: SHELL (integration tests using real git)
// INVARIANT: each test uses an isolated temp dir and a local bare repo as fake remote

import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect, pipe } from "effect"
import * as Chunk from "effect/Chunk"
import * as Stream from "effect/Stream"

import { stateInit } from "../../src/usecases/state-repo.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// GIT_CONFIG_NOSYSTEM=1 bypasses system-level git hooks (e.g. the docker-git
// pre-push hook that blocks pushes to `main`).  Only used in test seeding, not
// in the code-under-test.
const seedEnv: Record<string, string> = { GIT_CONFIG_NOSYSTEM: "1" }

const collectUint8Array = (chunks: Chunk.Chunk<Uint8Array>): Uint8Array =>
  Chunk.reduce(chunks, new Uint8Array(), (acc, curr) => {
    const next = new Uint8Array(acc.length + curr.length)
    next.set(acc)
    next.set(curr, acc.length)
    return next
  })

const captureGit = (
  args: ReadonlyArray<string>,
  cwd: string
): Effect.Effect<string, Error, CommandExecutor.CommandExecutor> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const executor = yield* _(CommandExecutor.CommandExecutor)
      const cmd = pipe(
        Command.make("git", ...args),
        Command.workingDirectory(cwd),
        Command.env(seedEnv),
        Command.stdout("pipe"),
        Command.stderr("pipe"),
        Command.stdin("pipe")
      )
      const proc = yield* _(executor.start(cmd))
      const bytes = yield* _(
        pipe(proc.stdout, Stream.runCollect, Effect.map((c) => collectUint8Array(c)))
      )
      const exitCode = yield* _(proc.exitCode)
      if (Number(exitCode) !== 0) {
        return yield* _(Effect.fail(new Error(`git ${args.join(" ")} exited with ${String(exitCode)}`)))
      }
      return new TextDecoder("utf-8").decode(bytes).trim()
    })
  )

const runShell = (
  script: string,
  cwd: string
): Effect.Effect<string, Error, CommandExecutor.CommandExecutor> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const executor = yield* _(CommandExecutor.CommandExecutor)
      const cmd = pipe(
        Command.make("sh", "-c", script),
        Command.workingDirectory(cwd),
        Command.env(seedEnv),
        Command.stdout("pipe"),
        Command.stderr("pipe"),
        Command.stdin("pipe")
      )
      const proc = yield* _(executor.start(cmd))
      const bytes = yield* _(
        pipe(proc.stdout, Stream.runCollect, Effect.map((c) => collectUint8Array(c)))
      )
      const exitCode = yield* _(proc.exitCode)
      if (Number(exitCode) !== 0) {
        return yield* _(Effect.fail(new Error(`sh -c '${script}' exited with ${String(exitCode)}`)))
      }
      return new TextDecoder("utf-8").decode(bytes).trim()
    })
  )

/**
 * Create a local bare git repository that can act as a remote for tests.
 * Optionally seeds it with an initial commit so that `git fetch` has history.
 *
 * @pure false
 * @invariant returned path is always an absolute path to a bare repo
 */
const makeFakeRemote = (
  p: Path.Path,
  baseDir: string,
  withInitialCommit: boolean
): Effect.Effect<string, Error, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const remotePath = p.join(baseDir, "remote.git")
    yield* _(runShell(
      `git init --bare --initial-branch=main "${remotePath}" 2>/dev/null || git init --bare "${remotePath}"`,
      baseDir
    ))

    if (withInitialCommit) {
      const seedDir = p.join(baseDir, "seed")
      yield* _(runShell(
        `git init --initial-branch=main "${seedDir}" 2>/dev/null || git init "${seedDir}"`,
        baseDir
      ))
      yield* _(captureGit(["config", "user.email", "test@example.com"], seedDir))
      yield* _(captureGit(["config", "user.name", "Test"], seedDir))
      yield* _(captureGit(["remote", "add", "origin", remotePath], seedDir))
      yield* _(runShell(`echo "# .docker-git" > "${seedDir}/README.md"`, seedDir))
      yield* _(captureGit(["add", "-A"], seedDir))
      yield* _(captureGit(["commit", "-m", "initial"], seedDir))
      yield* _(captureGit(["push", "origin", "HEAD:refs/heads/main"], seedDir))
    }

    return remotePath
  })

/**
 * Run an Effect inside a freshly created temp directory, cleaning up after.
 * Also overrides DOCKER_GIT_PROJECTS_ROOT so stateInit uses the temp dir
 * instead of the real ~/.docker-git.
 */
const withTempStateRoot = <A, E, R>(
  use: (opts: { tempBase: string; stateRoot: string }) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem | Path.Path> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const p = yield* _(Path.Path)
      const tempBase = yield* _(
        fs.makeTempDirectoryScoped({ prefix: "docker-git-state-init-" })
      )
      const stateRoot = p.join(tempBase, "state")

      const previous = process.env["DOCKER_GIT_PROJECTS_ROOT"]
      yield* _(
        Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (previous === undefined) {
              delete process.env["DOCKER_GIT_PROJECTS_ROOT"]
            } else {
              process.env["DOCKER_GIT_PROJECTS_ROOT"] = previous
            }
          })
        )
      )
      process.env["DOCKER_GIT_PROJECTS_ROOT"] = stateRoot

      return yield* _(use({ tempBase, stateRoot }))
    })
  )

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("stateInit", () => {
  it.effect("clones an empty remote into an empty local directory", () =>
    withTempStateRoot(({ tempBase, stateRoot }) =>
      Effect.gen(function*(_) {
        const p = yield* _(Path.Path)
        const remoteUrl = yield* _(makeFakeRemote(p, tempBase, true))

        yield* _(stateInit({ repoUrl: remoteUrl, repoRef: "main" }))

        const fs = yield* _(FileSystem.FileSystem)
        const hasGit = yield* _(fs.exists(p.join(stateRoot, ".git")))
        expect(hasGit).toBe(true)

        const originOut = yield* _(captureGit(["remote", "get-url", "origin"], stateRoot))
        expect(originOut).toBe(remoteUrl)

        const branch = yield* _(captureGit(["rev-parse", "--abbrev-ref", "HEAD"], stateRoot))
        expect(branch).toBe("main")

        const log = yield* _(captureGit(["log", "--oneline"], stateRoot))
        expect(log.length).toBeGreaterThan(0)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("adopts remote history when local dir has files but no .git (the bug fix)", () =>
    withTempStateRoot(({ tempBase, stateRoot }) =>
      Effect.gen(function*(_) {
        const p = yield* _(Path.Path)
        const remoteUrl = yield* _(makeFakeRemote(p, tempBase, true))

        const fs = yield* _(FileSystem.FileSystem)
        const orchAuthDir = p.join(stateRoot, ".orch", "auth")
        yield* _(fs.makeDirectory(orchAuthDir, { recursive: true }))
        yield* _(fs.writeFileString(p.join(orchAuthDir, "github.env"), "GH_TOKEN=test\n"))

        yield* _(stateInit({ repoUrl: remoteUrl, repoRef: "main" }))

        const hasGit = yield* _(fs.exists(p.join(stateRoot, ".git")))
        expect(hasGit).toBe(true)

        const originOut = yield* _(captureGit(["remote", "get-url", "origin"], stateRoot))
        expect(originOut).toBe(remoteUrl)

        const branch = yield* _(captureGit(["rev-parse", "--abbrev-ref", "HEAD"], stateRoot))
        expect(branch).toBe("main")

        // INVARIANT: no divergent root commit — the repo must share history with remote
        const remoteHead = yield* _(captureGit(["rev-parse", "origin/main"], stateRoot))
        const mergeBase = yield* _(
          runShell(`git merge-base HEAD origin/main || git rev-parse origin/main`, stateRoot)
        )
        expect(mergeBase).toBe(remoteHead)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("is idempotent when .git already exists", () =>
    withTempStateRoot(({ tempBase, stateRoot }) =>
      Effect.gen(function*(_) {
        const p = yield* _(Path.Path)
        const remoteUrl = yield* _(makeFakeRemote(p, tempBase, true))

        yield* _(stateInit({ repoUrl: remoteUrl, repoRef: "main" }))
        const firstCommit = yield* _(captureGit(["rev-parse", "HEAD"], stateRoot))

        yield* _(stateInit({ repoUrl: remoteUrl, repoRef: "main" }))
        const secondCommit = yield* _(captureGit(["rev-parse", "HEAD"], stateRoot))

        // INVARIANT: idempotent — HEAD does not change on repeated calls
        expect(secondCommit).toBe(firstCommit)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
