#!/bin/bash
# Test script for detect-code-changes.rs merge commit detection logic
#
# This script creates a temporary git repository with a synthetic merge
# commit (similar to GitHub Actions' pull_request checkout) and verifies
# that the detect-code-changes script correctly uses per-commit diff.
#
# Usage: bash experiments/test-detect-code-changes.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "=== Test: detect-code-changes merge commit detection ==="
echo "Temp dir: $TEMP_DIR"
echo ""

cd "$TEMP_DIR"
git init -b main test-repo
cd test-repo
git config user.email "test@test.com"
git config user.name "Test"

# --- Setup: Create a main branch with initial files ---
echo "fn main() {}" > main.rs
echo "[package]" > Cargo.toml
git add .
git commit -m "Initial commit"

# --- Create a PR branch with two commits ---
git checkout -b pr-branch

# Commit 1: touches code files
echo "fn foo() {}" >> main.rs
git add main.rs
git commit -m "Add foo function"

# Commit 2: touches only non-code files (like .gitkeep)
touch .gitkeep
git add .gitkeep
git commit -m "Add .gitkeep only"

PR_HEAD=$(git rev-parse HEAD)
PR_HEAD_PARENT=$(git rev-parse HEAD^)

# --- Go back to main and create a synthetic merge commit ---
git checkout main
git merge --no-ff pr-branch -m "Merge PR"

echo ""
echo "=== Git log ==="
git log --oneline --graph --all
echo ""

echo "=== Merge commit verification ==="
PARENT_COUNT=$(git cat-file -p HEAD | grep "^parent " | wc -l)
echo "HEAD parent count: $PARENT_COUNT (expected: 2)"

HEAD_SECOND_PARENT=$(git rev-parse HEAD^2)
echo "HEAD^2 (PR head): $HEAD_SECOND_PARENT"
echo "Expected PR head: $PR_HEAD"

if [ "$HEAD_SECOND_PARENT" = "$PR_HEAD" ]; then
  echo "PASS: HEAD^2 correctly points to PR head"
else
  echo "FAIL: HEAD^2 does not point to PR head"
  exit 1
fi

echo ""
echo "=== Diff comparisons ==="

echo ""
echo "--- Full PR diff (HEAD^ to HEAD) - WRONG for per-commit ---"
git diff --name-only HEAD^ HEAD
FULL_DIFF_COUNT=$(git diff --name-only HEAD^ HEAD | wc -l)
echo "Files: $FULL_DIFF_COUNT (includes main.rs + .gitkeep = both commits)"

echo ""
echo "--- Per-commit diff (HEAD^2^ to HEAD^2) - CORRECT ---"
git diff --name-only HEAD^2^ HEAD^2
PERCOMMIT_DIFF_COUNT=$(git diff --name-only HEAD^2^ HEAD^2 | wc -l)
echo "Files: $PERCOMMIT_DIFF_COUNT (should be only .gitkeep = last commit only)"

echo ""
echo "=== Assertions ==="

if [ "$FULL_DIFF_COUNT" -eq 2 ]; then
  echo "PASS: Full PR diff shows 2 files (both commits merged together)"
else
  echo "FAIL: Expected 2 files in full PR diff, got $FULL_DIFF_COUNT"
  exit 1
fi

if [ "$PERCOMMIT_DIFF_COUNT" -eq 1 ]; then
  echo "PASS: Per-commit diff shows 1 file (only latest commit)"
else
  echo "FAIL: Expected 1 file in per-commit diff, got $PERCOMMIT_DIFF_COUNT"
  exit 1
fi

PERCOMMIT_FILE=$(git diff --name-only HEAD^2^ HEAD^2)
if [ "$PERCOMMIT_FILE" = ".gitkeep" ]; then
  echo "PASS: Per-commit diff correctly shows only .gitkeep"
else
  echo "FAIL: Expected .gitkeep, got $PERCOMMIT_FILE"
  exit 1
fi

echo ""
echo "=== All tests passed ==="
