// CHANGE: add tests for pre-commit hook AI directory auto-staging and setup script
// WHY: guarantees that .gemini, .claude, .codex are auto-staged and setup configures hooks correctly
// REF: issue-170
// PURITY: SHELL (tests filesystem + git operations in isolated temp repos)

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(currentDir, "../../../..")

// Resolve absolute binary paths to satisfy sonarjs/no-os-command-from-path
const GIT_BIN = execFileSync("/usr/bin/which", ["git"], { encoding: "utf8" }).trim()
const NODE_BIN = process.execPath

/**
 * Creates an isolated git repo in a temp directory for testing
 *
 * @returns path to the temp repo root
 * @pure false — creates temp directory and initializes git repo
 */
const createTempRepo = (): string => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hook-test-"))
  execFileSync(GIT_BIN, ["init"], { cwd: tmpDir, stdio: "pipe" })
  execFileSync(GIT_BIN, ["config", "user.email", "test@test.com"], { cwd: tmpDir, stdio: "pipe" })
  execFileSync(GIT_BIN, ["config", "user.name", "Test"], { cwd: tmpDir, stdio: "pipe" })
  fs.writeFileSync(path.join(tmpDir, "README.md"), "init")
  execFileSync(GIT_BIN, ["add", "README.md"], { cwd: tmpDir, stdio: "pipe" })
  execFileSync(GIT_BIN, ["commit", "-m", "init"], { cwd: tmpDir, stdio: "pipe" })
  return tmpDir
}

/**
 * Runs the AI directory staging logic (mirrors pre-commit hook behavior) in a given repo
 *
 * @param cwd - the git repo directory
 * @pure false — stages files via git add
 */
const runAiDirStaging = (cwd: string): void => {
  for (const aiDir of [".gemini", ".claude", ".codex"]) {
    const dirPath = path.join(cwd, aiDir)
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      execFileSync(GIT_BIN, ["add", "-A", "--", aiDir], { cwd, stdio: "pipe" })
    }
  }
}

/**
 * Returns list of staged file names in a given repo
 *
 * @param cwd - the git repo directory
 * @returns array of staged file paths
 * @pure false — reads git index
 */
const getStagedFiles = (cwd: string): ReadonlyArray<string> => {
  const output = execFileSync(GIT_BIN, ["diff", "--cached", "--name-only"], {
    cwd,
    encoding: "utf8"
  }).trim()
  return output ? output.split("\n") : []
}

/**
 * Copies setup script into a temp repo and runs it
 *
 * @param repoDir - target git repo
 * @pure false — copies file, executes script, modifies git config
 */
const runSetupScript = (repoDir: string): void => {
  const scriptsDir = path.join(repoDir, "scripts")
  fs.mkdirSync(scriptsDir, { recursive: true })
  const srcScript = path.resolve(repoRoot, "scripts/setup-pre-commit-hook.js")
  fs.copyFileSync(srcScript, path.join(scriptsDir, "setup-pre-commit-hook.js"))
  execFileSync(NODE_BIN, ["scripts/setup-pre-commit-hook.js"], {
    cwd: repoDir,
    encoding: "utf8",
    stdio: "pipe"
  })
}

/**
 * Reads the generated hook content from a temp repo
 *
 * @param repoDir - target git repo
 * @returns hook file content
 * @pure false — reads filesystem
 */
const readGeneratedHook = (repoDir: string): string =>
  fs.readFileSync(path.join(repoDir, ".githooks", "pre-commit"), "utf8")

const AI_DIR_STAGING_SNIPPET = `for ai_dir in .gemini .claude .codex; do
  if [ -d "$ai_dir" ]; then
    git add -A -- "$ai_dir"
  fi
done`
const KNOWLEDGE_TMP_PRUNE_SNIPPET = String.raw`find . \
    \( -name ".git" -o -name "tmp" \) -type d -prune -o \
    \( -type d \( -name ".knowledge" -o -name ".knowlenge" \) -print0 \)`

// Tests that require an isolated temp git repo
describe("pre-commit hook (isolated repo)", () => {
  let repoDir: string

  beforeEach(() => {
    repoDir = createTempRepo()
  })
  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true })
  })

  describe("AI directory auto-staging logic", () => {
    // INVARIANT: ∀ dir ∈ {.gemini, .claude, .codex}: exists(dir) → staged(dir/*)
    it("stages .gemini, .claude, .codex directories when they exist", () => {
      for (const dir of [".gemini", ".claude", ".codex"]) {
        fs.mkdirSync(path.join(repoDir, dir), { recursive: true })
        fs.writeFileSync(path.join(repoDir, dir, "config.json"), `{"dir":"${dir}"}`)
      }

      runAiDirStaging(repoDir)
      const stagedFiles = getStagedFiles(repoDir)

      expect(stagedFiles).toContain(".gemini/config.json")
      expect(stagedFiles).toContain(".claude/config.json")
      expect(stagedFiles).toContain(".codex/config.json")
    })

    // INVARIANT: ¬exists(dir) → no_error ∧ no_staging
    it("skips non-existent AI directories without error", () => {
      fs.mkdirSync(path.join(repoDir, ".gemini"), { recursive: true })
      fs.writeFileSync(path.join(repoDir, ".gemini", "settings.txt"), "test")

      runAiDirStaging(repoDir)
      const stagedFiles = getStagedFiles(repoDir)

      expect(stagedFiles).toContain(".gemini/settings.txt")
      expect(stagedFiles.some((f) => f.startsWith(".claude/"))).toBe(false)
      expect(stagedFiles.some((f) => f.startsWith(".codex/"))).toBe(false)
    })

    // INVARIANT: ∀ f ∈ dir/*: staged(f) (recursive staging)
    it("stages nested files within AI directories", () => {
      fs.mkdirSync(path.join(repoDir, ".claude", "memory"), { recursive: true })
      fs.writeFileSync(path.join(repoDir, ".claude", "memory", "context.md"), "# Context")
      fs.writeFileSync(path.join(repoDir, ".claude", "settings.json"), "{}")

      runAiDirStaging(repoDir)
      const stagedFiles = getStagedFiles(repoDir)

      expect(stagedFiles).toContain(".claude/memory/context.md")
      expect(stagedFiles).toContain(".claude/settings.json")
    })

    // INVARIANT: empty_dir → no_staging ∧ no_error
    it("handles empty AI directories gracefully", () => {
      fs.mkdirSync(path.join(repoDir, ".codex"), { recursive: true })

      runAiDirStaging(repoDir)

      expect(getStagedFiles(repoDir)).toHaveLength(0)
    })
  })

  describe("setup-pre-commit-hook.js", () => {
    // INVARIANT: ∃ .githooks/pre-commit after setup ∧ executable(pre-commit)
    it("creates .githooks/pre-commit with correct permissions", () => {
      runSetupScript(repoDir)

      const hookPath = path.join(repoDir, ".githooks", "pre-commit")
      expect(fs.existsSync(hookPath)).toBe(true)

      const stats = fs.statSync(hookPath)
      expect(stats.mode & 0o111).toBeGreaterThan(0)
    })

    // INVARIANT: hook_content contains AI dir staging logic
    it("generated hook includes AI directory auto-staging for .gemini, .claude, .codex", () => {
      runSetupScript(repoDir)
      const hookContent = readGeneratedHook(repoDir)

      expect(hookContent).toContain(".gemini")
      expect(hookContent).toContain(".claude")
      expect(hookContent).toContain(".codex")
      expect(hookContent).toContain(AI_DIR_STAGING_SNIPPET)
      expect(hookContent).toContain(KNOWLEDGE_TMP_PRUNE_SNIPPET)
    })

    // INVARIANT: core.hooksPath = ".githooks" after setup
    it("configures git core.hooksPath to .githooks", () => {
      runSetupScript(repoDir)

      const hooksPath = execFileSync(GIT_BIN, ["config", "core.hooksPath"], {
        cwd: repoDir,
        encoding: "utf8"
      }).trim()

      expect(hooksPath).toBe(".githooks")
    })

    // INVARIANT: idempotent(setup) — running twice produces same result
    it("is idempotent — running setup twice produces the same result", () => {
      runSetupScript(repoDir)
      const firstContent = readGeneratedHook(repoDir)

      runSetupScript(repoDir)
      const secondContent = readGeneratedHook(repoDir)

      expect(firstContent).toBe(secondContent)
    })
  })
})

// Tests that verify the committed repo files directly (no temp repo needed)
describe("committed hook files", () => {
  // INVARIANT: ∀ dir ∈ {.claude, .gemini, .codex}: dir ∉ gitignore_entries
  it(".gitignore does not ignore .claude, .gemini, or .codex directories", () => {
    const content = fs.readFileSync(path.resolve(repoRoot, ".gitignore"), "utf8")
    const lines = content.split("\n").map((line) => line.trim())

    for (const dir of [".claude", ".gemini", ".codex"]) {
      expect(lines).not.toContain(dir)
      expect(lines).not.toContain(`${dir}/`)
    }
  })

  // INVARIANT: .githooks/pre-commit contains AI staging logic with correct structure
  it("pre-commit hook has AI staging logic, correct shebang, and strict mode", () => {
    const content = fs.readFileSync(path.resolve(repoRoot, ".githooks/pre-commit"), "utf8")

    expect(content).toContain(AI_DIR_STAGING_SNIPPET)
    expect(content).toContain(KNOWLEDGE_TMP_PRUNE_SNIPPET)
    expect(content.startsWith("#!/usr/bin/env bash\n")).toBe(true)
    expect(content).toContain("set -euo pipefail")
  })
})
