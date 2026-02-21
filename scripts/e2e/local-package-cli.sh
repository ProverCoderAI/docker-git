#!/usr/bin/env bash
set -euo pipefail

RUN_ID="$(date +%s)-$RANDOM"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ROOT_BASE="${DOCKER_GIT_E2E_ROOT_BASE:-/tmp/docker-git-e2e-root}"
mkdir -p "$ROOT_BASE"
ROOT="$(mktemp -d "$ROOT_BASE/local-package-cli.XXXXXX")"
KEEP="${KEEP:-0}"

PACK_LOG="$ROOT/npm-pack.log"
HELP_LOG="$ROOT/docker-git-help.log"
TAR_LIST="$ROOT/tar-list.txt"
PACKED_TARBALL=""

fail() {
  echo "e2e/local-package-cli: $*" >&2
  exit 1
}

on_error() {
  local line="$1"
  echo "e2e/local-package-cli: failed at line $line" >&2
  if [[ -f "$PACK_LOG" ]]; then
    echo "--- npm pack log ---" >&2
    cat "$PACK_LOG" >&2 || true
  fi
  if [[ -f "$HELP_LOG" ]]; then
    echo "--- docker-git --help log ---" >&2
    cat "$HELP_LOG" >&2 || true
  fi
}

cleanup() {
  if [[ "$KEEP" == "1" ]]; then
    echo "e2e/local-package-cli: KEEP=1 set; preserving temp dir: $ROOT" >&2
    return
  fi
  if [[ -n "$PACKED_TARBALL" ]] && [[ -f "$PACKED_TARBALL" ]]; then
    rm -f "$PACKED_TARBALL" >/dev/null 2>&1 || true
  fi
  rm -rf "$ROOT" >/dev/null 2>&1 || true
}

trap 'on_error $LINENO' ERR
trap cleanup EXIT

cd "$REPO_ROOT/packages/app"
npm pack --silent >"$PACK_LOG"
tarball_name="$(tail -n 1 "$PACK_LOG" | tr -d '\r')"
[[ -n "$tarball_name" ]] || fail "npm pack did not return tarball name"

PACKED_TARBALL="$REPO_ROOT/packages/app/$tarball_name"
[[ -f "$PACKED_TARBALL" ]] || fail "packed tarball not found: $PACKED_TARBALL"

tar -tf "$PACKED_TARBALL" >"$TAR_LIST"
while IFS= read -r entry; do
  case "$entry" in
    package/package.json|package/README*|package/LICENSE*|package/CHANGELOG*|package/dist/*)
      ;;
    *)
      fail "unexpected file in packed tarball: $entry"
      ;;
  esac
done <"$TAR_LIST"

grep -Fxq "package/dist/src/docker-git/main.js" "$TAR_LIST" \
  || fail "packed tarball does not include dist/src/docker-git/main.js"

dep_keys="$(tar -xOf "$PACKED_TARBALL" package/package.json | node -e 'let s="";process.stdin.on("data",(c)=>{s+=c});process.stdin.on("end",()=>{const pkg=JSON.parse(s);const deps=Object.keys(pkg.dependencies ?? {});if (deps.includes("@effect-template/lib")) {console.error("@effect-template/lib must not be a runtime dependency in packed package");process.exit(1)}process.stdout.write(deps.join(","));});')"
[[ "$dep_keys" == *"effect"* ]] || fail "packed dependency set looks invalid: $dep_keys"

mkdir -p "$ROOT/project"
cd "$ROOT/project"
npm init -y >/dev/null
pnpm add "$PACKED_TARBALL" --silent --lockfile=false
pnpm docker-git --help >"$HELP_LOG" 2>&1

grep -Fq -- "docker-git clone <url> [options]" "$HELP_LOG" \
  || fail "expected docker-git help output from local packed package"

echo "e2e/local-package-cli: local tarball install + pnpm docker-git --help OK" >&2
