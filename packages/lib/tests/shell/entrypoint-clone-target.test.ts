// CHANGE: pin the standalone base-image clone target to the dev-owned app folder
// WHY: entrypoint runs `git clone` as `su - dev`; cloning into a root-owned dir (e.g. /work/app)
//      fails with permission denied, so the repo never lands in the prepared `app` folder
// QUOTE(ТЗ): "Почему-то при docker-git clone не делается git clone в папку app"
// REF: issue-408
// SOURCE: n/a
// FORMAT THEOREM: defaultTargetDir(entrypoint) = appDir(Dockerfile) ∧ appDir ⊂ chown(dev, /home/dev)
// PURITY: SHELL (reads repository source files)
// INVARIANT: clone target is owned by the unprivileged clone user
// COMPLEXITY: O(|file|)
import { describe, expect, it } from "@effect/vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// packages/lib/tests/shell -> repository root
const repoRoot = path.resolve(__dirname, "..", "..", "..", "..")

const readRepoFile = (relativePath: string): string =>
  readFileSync(path.join(repoRoot, relativePath), "utf8")

describe("standalone base-image clone target", () => {
  const entrypoint = readRepoFile("entrypoint.sh")
  const dockerfile = readRepoFile("Dockerfile")

  // CHANGE: derive the dev home that the Dockerfile recursively chowns to the clone user
  // WHY: `git clone` runs as `su - dev`, so the target must live under a dev-owned path
  // PURITY: CORE
  // INVARIANT: chownedHome captures the `chown -R dev:dev <home>` argument
  const chownedHome = (() => {
    const match = dockerfile.match(/chown -R dev:dev (\/home\/dev)\b/)
    return match?.[1]
  })()

  // CHANGE: derive the default TARGET_DIR the entrypoint clones into
  // WHY: the bug is a wrong default that points outside the dev-owned home
  // PURITY: CORE
  // INVARIANT: defaultTargetDir captures `TARGET_DIR="${TARGET_DIR:-<default>}"`
  const defaultTargetDir = (() => {
    const match = entrypoint.match(/TARGET_DIR="\$\{TARGET_DIR:-([^}]+)\}"/)
    return match?.[1]
  })()

  it("prepares an app folder under the dev home in the Dockerfile", () => {
    expect(dockerfile).toContain("mkdir -p /home/dev/app")
    expect(chownedHome).toBe("/home/dev")
  })

  it("defaults the clone target to the prepared app folder", () => {
    expect(defaultTargetDir).toBe("/home/dev/app")
  })

  it("keeps the clone target under the dev-owned home so `su - dev` can write into it", () => {
    expect(defaultTargetDir).toBeDefined()
    expect(chownedHome).toBeDefined()
    expect(`${defaultTargetDir}/`.startsWith(`${chownedHome}/`)).toBe(true)
  })
})
