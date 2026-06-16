// CHANGE: pin the standalone base-image clone target to the dev-owned app folder
// WHY: entrypoint runs `git clone` as `su - dev`; cloning into a root-owned dir (e.g. /work/app)
//      fails with permission denied, so the repo never lands in the prepared `app` folder
// QUOTE(ТЗ): "Почему-то при docker-git clone не делается git clone в папку app"
// REF: issue-408
// SOURCE: n/a
// FORMAT THEOREM: defaultTargetDir(entrypoint) = appDir(Dockerfile) ∧ appDir ⊂ chown(dev, /home/dev)
// PURITY: SHELL (reads repository source files via @effect/platform FileSystem)
// INVARIANT: clone target is owned by the unprivileged clone user
// COMPLEXITY: O(|file|)
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

// CHANGE: derive the dev home that the Dockerfile recursively chowns to the clone user
// WHY: `git clone` runs as `su - dev`, so the target must live under a dev-owned path
// PURITY: CORE
// INVARIANT: returns the `chown -R dev:dev <home>` argument, or "" when absent
const matchChownedHome = (dockerfile: string): string =>
  dockerfile.match(/chown -R dev:dev (\/home\/dev)\b/)?.[1] ?? ""

// CHANGE: derive the default TARGET_DIR the entrypoint clones into
// WHY: the bug is a wrong default that points outside the dev-owned home
// PURITY: CORE
// INVARIANT: returns the `TARGET_DIR="${TARGET_DIR:-<default>}"` value, or "" when absent
const matchDefaultTargetDir = (entrypoint: string): string =>
  entrypoint.match(/TARGET_DIR="\$\{TARGET_DIR:-([^}]+)\}"/)?.[1] ?? ""

// CHANGE: read the repo-root entrypoint + Dockerfile through the Effect FileSystem service
// WHY: lint forbids node:* imports; @effect/platform is the sanctioned IO boundary
// PURITY: SHELL
// EFFECT: Effect<{ entrypoint, dockerfile }, PlatformError | BadArgument, FileSystem | Path>
const readRepoSources = Effect.gen(function*(_) {
  const fs = yield* _(FileSystem.FileSystem)
  const path = yield* _(Path.Path)
  const here = yield* _(path.fromFileUrl(new URL(import.meta.url)))
  // packages/lib/tests/shell -> repository root
  const repoRoot = path.resolve(path.dirname(here), "..", "..", "..", "..")
  const entrypoint = yield* _(fs.readFileString(path.join(repoRoot, "entrypoint.sh")))
  const dockerfile = yield* _(fs.readFileString(path.join(repoRoot, "Dockerfile")))
  return { dockerfile, entrypoint }
})

describe("standalone base-image clone target", () => {
  it.effect("prepares an app folder under the dev home in the Dockerfile", () =>
    Effect.gen(function*(_) {
      const { dockerfile } = yield* _(readRepoSources)
      expect(dockerfile).toContain("mkdir -p /home/dev/app")
      expect(matchChownedHome(dockerfile)).toBe("/home/dev")
    }).pipe(Effect.provide(NodeContext.layer)))

  it.effect("defaults the clone target to the prepared app folder", () =>
    Effect.gen(function*(_) {
      const { entrypoint } = yield* _(readRepoSources)
      expect(matchDefaultTargetDir(entrypoint)).toBe("/home/dev/app")
    }).pipe(Effect.provide(NodeContext.layer)))

  it.effect("keeps the clone target under the dev-owned home so `su - dev` can write into it", () =>
    Effect.gen(function*(_) {
      const { dockerfile, entrypoint } = yield* _(readRepoSources)
      const chownedHome = matchChownedHome(dockerfile)
      const defaultTargetDir = matchDefaultTargetDir(entrypoint)
      expect(chownedHome).not.toBe("")
      expect(defaultTargetDir).not.toBe("")
      expect(`${defaultTargetDir}/`.startsWith(`${chownedHome}/`)).toBe(true)
    }).pipe(Effect.provide(NodeContext.layer)))
})
