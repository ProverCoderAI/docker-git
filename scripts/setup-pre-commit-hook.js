#!/usr/bin/env node

// CHANGE: Add repeatable pre-commit hook setup for secret auto-redaction and AI session directory staging
// WHY: Keep secret scanning on every commit without one-time manual hook wiring,
//      and automatically include .gemini, .claude, .codex directories in commits.
// REF: issue-170
// SOURCE: n/a
// PURITY: SHELL (git config + filesystem)

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

const hooksDir = path.join(repoRoot, ".githooks");
const hookPath = path.join(hooksDir, "pre-commit");

fs.mkdirSync(hooksDir, { recursive: true });
fs.writeFileSync(
  hookPath,
  `#!/usr/bin/env bash
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HOOK_DIR/.." && pwd)"
cd "$REPO_ROOT"

node scripts/split-knowledge-large-files.js
while IFS= read -r -d '' knowledge_dir; do
  git add -A -- "$knowledge_dir"
done < <(
  find . \\
    \\( -name ".git" -o -name "tmp" \\) -type d -prune -o \\
    \\( -type d \\( -name ".knowledge" -o -name ".knowlenge" \\) -print0 \\)
)

# CHANGE: auto-stage AI agent config directories (.gemini, .claude, .codex)
# WHY: ensures AI session context is always included in commits without manual git add
# REF: issue-170
for ai_dir in .gemini .claude .codex; do
  if [ -d "$ai_dir" ]; then
    git add -A -- "$ai_dir"
  fi
done

MAX_BYTES=$((99 * 1000 * 1000))
too_large=()

while IFS= read -r -d '' path; do
  if ! git cat-file -e ":$path" 2>/dev/null; then
    continue
  fi
  size=$(git cat-file -s ":$path")
  if [ "$size" -gt "$MAX_BYTES" ]; then
    too_large+=("$path ($size bytes)")
  fi
done < <(git diff --cached --name-only -z --diff-filter=ACM)

if [ "\${#too_large[@]}" -gt 0 ]; then
  echo "ERROR: Staged files exceed 99MB limit (99,000,000 bytes)."
  printf ' - %s\\n' "\${too_large[@]}"
  exit 1
fi

bash "$REPO_ROOT/scripts/pre-commit-secret-guard.sh"
`,
  "utf8"
);

fs.chmodSync(hookPath, 0o755);

// CHANGE: automatically configure core.hooksPath so hooks are active immediately
// WHY: previously required a manual step that was easy to forget, causing hooks to never run
// REF: issue-170
const { execFileSync } = require("node:child_process");
try {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  console.log("Installed .githooks/pre-commit and configured core.hooksPath = .githooks");
} catch (error) {
  console.log("Installed .githooks/pre-commit.");
  console.log("Enable it for this repository with: git config core.hooksPath .githooks");
}
