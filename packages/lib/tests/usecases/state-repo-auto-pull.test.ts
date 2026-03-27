// CHANGE: integration tests for autoPullState — git pull on .docker-git at startup
// WHY: ensure docker-git performs git pull on .docker-git folder every time it is invoked
// QUOTE(ТЗ): "Сделать что бы когда вызывается команда docker-git то происходит git pull для .docker-git папки"
// REF: issue-178
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

import { autoPullState } from "../../src/usecases/state-repo.js"

// ---------------------------------------------------------------------------
// Helpers (same pattern as state-repo-init.test.ts)
// ---------------------------------------------------------------------------

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

const withTempStateRoot = <A, E, R>(
  use: (opts: { tempBase: string; stateRoot: string }) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem | Path.Path> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const p = yield* _(Path.Path)
      const tempBase = yield* _(
        fs.makeTempDirectoryScoped({ prefix: "docker-git-auto-pull-" })
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

describe("autoPullState", () => {
  it.effect("pulls new commits from remote into .docker-git", () =>
    withTempStateRoot(({ tempBase, stateRoot }) =>
      Effect.gen(function*(_) {
        const p = yield* _(Path.Path)
        const remoteUrl = yield* _(makeFakeRemote(p, tempBase, true))

        // Clone the remote into stateRoot (simulating an existing .docker-git)
        yield* _(runShell(
          `git clone "${remoteUrl}" "${stateRoot}"`,
          tempBase
        ))
        const headBefore = yield* _(captureGit(["rev-parse", "HEAD"], stateRoot))

        // Push a new commit to the remote from a separate working copy
        const pusherDir = p.join(tempBase, "pusher")
        yield* _(runShell(`git clone "${remoteUrl}" "${pusherDir}"`, tempBase))
        yield* _(captureGit(["config", "user.email", "test@example.com"], pusherDir))
        yield* _(captureGit(["config", "user.name", "Test"], pusherDir))
        yield* _(runShell(`echo "new content" > "${pusherDir}/new-file.txt"`, pusherDir))
        yield* _(captureGit(["add", "-A"], pusherDir))
        yield* _(captureGit(["commit", "-m", "add new file"], pusherDir))
        yield* _(captureGit(["push", "origin", "HEAD:refs/heads/main"], pusherDir))

        const remoteHead = yield* _(captureGit(["rev-parse", "HEAD"], pusherDir))
        expect(remoteHead).not.toBe(headBefore)

        // Run autoPullState — it should pull the new commit
        yield* _(autoPullState)

        const headAfter = yield* _(captureGit(["rev-parse", "HEAD"], stateRoot))
        expect(headAfter).toBe(remoteHead)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("does nothing when .docker-git is not a git repo", () =>
    withTempStateRoot(({ stateRoot }) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        yield* _(fs.makeDirectory(stateRoot, { recursive: true }))
        yield* _(fs.writeFileString(`${stateRoot}/some-file.txt`, "content\n"))

        // Should not fail even though the dir is not a git repo
        yield* _(autoPullState)

        // Directory is unchanged
        const content = yield* _(fs.readFileString(`${stateRoot}/some-file.txt`))
        expect(content).toBe("content\n")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("does nothing when .docker-git has no origin remote", () =>
    withTempStateRoot(({ stateRoot }) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        yield* _(fs.makeDirectory(stateRoot, { recursive: true }))
        yield* _(runShell(
          `git init --initial-branch=main "${stateRoot}" 2>/dev/null || git init "${stateRoot}"`,
          stateRoot
        ))
        yield* _(captureGit(["config", "user.email", "test@example.com"], stateRoot))
        yield* _(captureGit(["config", "user.name", "Test"], stateRoot))
        yield* _(runShell(`echo "data" > "${stateRoot}/file.txt"`, stateRoot))
        yield* _(captureGit(["add", "-A"], stateRoot))
        yield* _(captureGit(["commit", "-m", "init"], stateRoot))

        const headBefore = yield* _(captureGit(["rev-parse", "HEAD"], stateRoot))

        // Should not fail and not change HEAD
        yield* _(autoPullState)

        const headAfter = yield* _(captureGit(["rev-parse", "HEAD"], stateRoot))
        expect(headAfter).toBe(headBefore)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("respects DOCKER_GIT_STATE_AUTO_PULL=false to skip pull", () =>
    withTempStateRoot(({ tempBase, stateRoot }) =>
      Effect.gen(function*(_) {
        const p = yield* _(Path.Path)
        const remoteUrl = yield* _(makeFakeRemote(p, tempBase, true))

        yield* _(runShell(`git clone "${remoteUrl}" "${stateRoot}"`, tempBase))
        const headBefore = yield* _(captureGit(["rev-parse", "HEAD"], stateRoot))

        // Push a new commit
        const pusherDir = p.join(tempBase, "pusher")
        yield* _(runShell(`git clone "${remoteUrl}" "${pusherDir}"`, tempBase))
        yield* _(captureGit(["config", "user.email", "test@example.com"], pusherDir))
        yield* _(captureGit(["config", "user.name", "Test"], pusherDir))
        yield* _(runShell(`echo "new" > "${pusherDir}/new.txt"`, pusherDir))
        yield* _(captureGit(["add", "-A"], pusherDir))
        yield* _(captureGit(["commit", "-m", "new commit"], pusherDir))
        yield* _(captureGit(["push", "origin", "HEAD:refs/heads/main"], pusherDir))

        // Disable auto-pull via env var and restore after
        const prevAutoPull = process.env["DOCKER_GIT_STATE_AUTO_PULL"]
        process.env["DOCKER_GIT_STATE_AUTO_PULL"] = "false"
        yield* _(
          Effect.ensuring(
            autoPullState,
            Effect.sync(() => {
              if (prevAutoPull === undefined) {
                delete process.env["DOCKER_GIT_STATE_AUTO_PULL"]
              } else {
                process.env["DOCKER_GIT_STATE_AUTO_PULL"] = prevAutoPull
              }
            })
          )
        )

        // HEAD should NOT have changed because auto-pull was disabled
        const headAfter = yield* _(captureGit(["rev-parse", "HEAD"], stateRoot))
        expect(headAfter).toBe(headBefore)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("does not fail when .docker-git directory does not exist", () =>
    withTempStateRoot(() =>
      Effect.gen(function*(_) {
        // stateRoot does not exist at all — autoPullState should silently succeed
        yield* _(autoPullState)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
