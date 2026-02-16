#!/usr/bin/env bash
set -euo pipefail

# CHANGE: Add staged knowledge secret guard with external scanner support.
# WHY: Prefer proven scanners (gitleaks) when available, while keeping deterministic fallback redaction.

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

command -v git >/dev/null || { echo "ERROR: git is required" >&2; exit 1; }
command -v perl >/dev/null || { echo "ERROR: perl is required" >&2; exit 1; }

SECRET_PATTERN='(\b(?:github_pat_|gho_|ghp_|ghu_|ghs_|ghr_|gha_)[A-Za-z0-9_]{20,255}\b|\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}\b|\bsk-ant-[A-Za-z0-9_-]{20,}\b|-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----)'
HAS_GITLEAKS=0

if command -v gitleaks >/dev/null 2>&1; then
  HAS_GITLEAKS=1
fi

is_knowledge_path() {
  local path="$1"
  [[ "$path" =~ (^|/)\.(knowledge|knowlenge)(/|$) ]]
}

scan_with_gitleaks_file() {
  local file_path="$1"
  if [ "$HAS_GITLEAKS" -ne 1 ]; then
    printf '%s\n' "skip"
    return
  fi

  if gitleaks stdin --no-banner --redact --log-level error < "$file_path" >/dev/null 2>&1; then
    printf '%s\n' "clean"
    return
  fi

  local code=$?
  if [ "$code" -eq 1 ]; then
    printf '%s\n' "hit"
    return
  fi

  printf '%s\n' "error"
}

staged_blob_to_file() {
  local path="$1"
  local out="$2"
  git cat-file -p ":$path" > "$out"
}

has_secret_in_staged_blob() {
  local staged_blob_path="$1"
  local gitleaks_state
  gitleaks_state="$(scan_with_gitleaks_file "$staged_blob_path")"

  if [ "$gitleaks_state" = "hit" ]; then
    return 0
  fi
  if grep -Pq "$SECRET_PATTERN" "$staged_blob_path"; then
    return 0
  fi
  return 1
}

redacted_count=0
manual_fix_files=()
has_staged_files=0

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
index=0

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
  has_unstaged=true
  if git diff --quiet -- "$path"; then
    has_unstaged=false
  fi

  index=$((index + 1))
  tmp_path="${TMP_DIR}/entry-${index}"
  staged_blob_to_file "$path" "$tmp_path"
  if ! has_secret_in_staged_blob "$tmp_path"; then
    continue
  fi

  if [ "$has_unstaged" = true ]; then
    manual_fix_files+=("$path")
    continue
  fi

  perl -0pi -e '
    s/\b(?:github_pat_|gho_|ghp_|ghu_|ghs_|ghr_|gha_)[A-Za-z0-9_]{20,255}\b/<REDACTED_GITHUB_TOKEN>/g;
    s/\bsk-ant-[A-Za-z0-9_-]{20,}\b/<REDACTED_ANTHROPIC_KEY>/g;
    s/\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}\b/<REDACTED_OPENAI_KEY>/g;
    s/-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)* PRIVATE KEY-----/<REDACTED_PRIVATE_KEY>/g;
  ' "$path"
  git add -- "$path"

  redacted_path="${TMP_DIR}/post-redacted-${index}"
  staged_blob_to_file "$path" "$redacted_path"
  if has_secret_in_staged_blob "$redacted_path"; then
    manual_fix_files+=("$path")
  else
    redacted_count=$((redacted_count + 1))
  fi
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
  if [ "$HAS_GITLEAKS" -eq 1 ]; then
    echo "pre-commit: auto-redacted secrets in $redacted_count staged .knowledge/.knowlenge file(s) (scanner: gitleaks + fallback)."
  else
    echo "pre-commit: auto-redacted secrets in $redacted_count staged .knowledge/.knowlenge file(s) (scanner: fallback regex)."
  fi
fi

exit 0
