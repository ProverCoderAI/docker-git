#!/usr/bin/env bash
set -euo pipefail

# Test that the pre-commit hook logic correctly stages AI config directories
echo "=== Testing AI directory auto-staging logic ==="

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Create test AI directories with test files
for ai_dir in .gemini .claude .codex; do
  mkdir -p "$ai_dir"
  echo "test-content-$(date +%s)" > "$ai_dir/test-file.txt"
done

echo "Created test files:"
ls -la .gemini/test-file.txt .claude/test-file.txt .codex/test-file.txt

# Check gitignore status
echo ""
echo "=== Checking gitignore status ==="
for ai_dir in .gemini .claude .codex; do
  if git check-ignore -q "$ai_dir/test-file.txt" 2>/dev/null; then
    echo "IGNORED: $ai_dir (this is a problem!)"
  else
    echo "NOT IGNORED: $ai_dir (good - can be tracked)"
  fi
done

# Simulate the auto-staging logic from the pre-commit hook
echo ""
echo "=== Simulating auto-staging ==="
for ai_dir in .gemini .claude .codex; do
  if [ -d "$ai_dir" ]; then
    git add -A -- "$ai_dir"
    echo "Staged: $ai_dir"
  fi
done

echo ""
echo "=== Staged files ==="
git diff --cached --name-only | grep -E "^\.(gemini|claude|codex)/" || echo "(none found)"

# Clean up - unstage the test files
git reset HEAD -- .gemini .claude .codex 2>/dev/null || true
rm -rf .gemini/test-file.txt .claude/test-file.txt .codex/test-file.txt

echo ""
echo "=== Test complete ==="
