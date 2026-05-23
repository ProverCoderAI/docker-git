#!/bin/bash
# Test script for version check - dependency changes only (no version change)

echo "=== Test: Cargo.toml changed but NOT version ==="
# Save original
cp Cargo.toml Cargo.toml.bak

# Create a temporary commit with non-version change
git checkout -b test-deps-change-branch 2>/dev/null || git checkout test-deps-change-branch 2>/dev/null
echo '# Test comment' >> Cargo.toml
git add Cargo.toml
git commit -m "Test dependency change" --no-verify 2>/dev/null || true

# Run the check
GITHUB_EVENT_NAME=pull_request GITHUB_HEAD_REF=test-deps-change-branch GITHUB_BASE_REF=main node scripts/check-version-modification.mjs
echo "Exit code: $?"

# Restore
git checkout issue-14-9d4fe6371f90 2>/dev/null
cp Cargo.toml.bak Cargo.toml
rm Cargo.toml.bak
git branch -D test-deps-change-branch 2>/dev/null || true
