#!/usr/bin/env node

// CHANGE: Add repeatable pre-commit hook setup for secret auto-redaction
// WHY: Keep secret scanning on every commit without one-time manual hook wiring.
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
if [ -d ".knowledge" ]; then
  git add -A .knowledge
fi

if [ -d ".knowlenge" ]; then
  git add -A .knowlenge
fi

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

console.log(
  "Installed .githooks/pre-commit."
);
console.log("Enable it for this repository with: git config core.hooksPath .githooks");
