#!/bin/bash
# Test script for version check

echo "=== Test 1: No version change in Cargo.toml ==="
GITHUB_EVENT_NAME=pull_request GITHUB_HEAD_REF=test-branch GITHUB_BASE_REF=main node scripts/check-version-modification.mjs
echo "Exit code: $?"
echo ""

echo "=== Test 2: Automated release branch (should skip) ==="
GITHUB_EVENT_NAME=pull_request GITHUB_HEAD_REF=changelog-manual-release-12345 GITHUB_BASE_REF=main node scripts/check-version-modification.mjs
echo "Exit code: $?"
echo ""

echo "=== Test 3: Non-PR event (should skip) ==="
GITHUB_EVENT_NAME=push GITHUB_HEAD_REF=main GITHUB_BASE_REF=main node scripts/check-version-modification.mjs
echo "Exit code: $?"
echo ""

echo "=== Test 4: Simulating version change ==="
# Save original
cp Cargo.toml Cargo.toml.bak

# Create a temporary commit with version change
git checkout -b test-version-change-branch 2>/dev/null || git checkout test-version-change-branch 2>/dev/null
sed -i 's/version = "0.1.0"/version = "0.2.0"/' Cargo.toml
git add Cargo.toml
git commit -m "Test version change" --no-verify 2>/dev/null || true

# Run the check
GITHUB_EVENT_NAME=pull_request GITHUB_HEAD_REF=test-version-change-branch GITHUB_BASE_REF=main node scripts/check-version-modification.mjs
echo "Exit code: $?"

# Restore
git checkout issue-14-9d4fe6371f90 2>/dev/null
cp Cargo.toml.bak Cargo.toml
rm Cargo.toml.bak
git branch -D test-version-change-branch 2>/dev/null || true
