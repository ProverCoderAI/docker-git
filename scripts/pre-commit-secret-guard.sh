#!/usr/bin/env bash
set -euo pipefail

# CHANGE: Add bash-only pre-commit guard that redacts secret-like tokens in staged .knowledge/.knowlenge files.
# WHY: Keep knowledge folders safe to commit even when users paste credentials by mistake.

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

command -v git >/dev/null || { echo "ERROR: git is required" >&2; exit 1; }
command -v perl >/dev/null || { echo "ERROR: perl is required" >&2; exit 1; }

SECRET_PATTERN='(\b(?:github_pat_|gho_|ghp_|ghu_|ghs_|ghr_|gha_)[A-Za-z0-9_]{20,255}\b|\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}\b|\bsk-ant-[A-Za-z0-9_-]{20,}\b|-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----)'

is_knowledge_path() {
  local path="$1"
  [[ "$path" =~ (^|/)\.(knowledge|knowlenge)(/|$) ]]
}

redacted_count=0
manual_fix_files=()
has_staged_files=0

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

while IFS= read -r -d '' path; do
  if [ -z "$path" ]; then
    continue
  fi
  if ! is_knowledge_path "$path"; then
    continue
  fi

  if ! git cat-file -e ":$path" 2>/dev/null; then
    continue
  fi

  has_staged_files=1
  tmp_path="${TMP_DIR}/entry"
  has_unstaged=false

  if ! git diff --quiet -- "$path"; then
    has_unstaged=true
  fi

  if [ "$has_unstaged" = true ]; then
    git cat-file -p ":$path" > "$tmp_path"
    if grep -Pq "$SECRET_PATTERN" "$tmp_path"; then
      manual_fix_files+=("$path")
    fi

    continue
  fi

  if ! grep -Pq "$SECRET_PATTERN" "$path"; then
    continue
  fi

  perl -0pi -e '
    s/\b(?:github_pat_|gho_|ghp_|ghu_|ghs_|ghr_|gha_)[A-Za-z0-9_]{20,255}\b/<REDACTED_GITHUB_TOKEN>/g;
    s/\bsk-ant-[A-Za-z0-9_-]{20,}\b/<REDACTED_ANTHROPIC_KEY>/g;
    s/\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}\b/<REDACTED_OPENAI_KEY>/g;
    s/-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)* PRIVATE KEY-----/<REDACTED_PRIVATE_KEY>/g;
  ' "$path"
  git add -- "$path"
  redacted_count=$((redacted_count + 1))
done < <(git diff --cached --name-only --diff-filter=ACM -z)

if [ "$has_staged_files" -eq 0 ]; then
  exit 0
fi

if [ "${#manual_fix_files[@]}" -gt 0 ]; then
  echo "ERROR: secret-like tokens found in staged .knowledge/.knowlenge files with unstaged changes."
  echo "Please fix these files manually in index or clear unstaged changes, then commit again:"
  for file in "${manual_fix_files[@]}"; do
    echo " - $file"
  done
  echo "Hint: clean working tree for those files first (git restore --worktree -- <file> && git add -- <file>)."
  exit 1
fi

if [ "$redacted_count" -gt 0 ]; then
  echo "pre-commit: auto-redacted secrets in $redacted_count staged .knowledge/.knowlenge file(s)."
fi

exit 0
