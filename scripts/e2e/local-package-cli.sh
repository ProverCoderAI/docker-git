#!/usr/bin/env bash
set -euo pipefail

RUN_ID="$(date +%s)-$RANDOM"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$REPO_ROOT/scripts/e2e/_lib.sh"
ROOT_BASE="${DOCKER_GIT_E2E_ROOT_BASE:-/tmp/docker-git-e2e-root}"
mkdir -p "$ROOT_BASE"
ROOT="$(mktemp -d "$ROOT_BASE/local-package-cli.XXXXXX")"
KEEP="${KEEP:-0}"

PACK_LOG="$ROOT/bun-pack.log"
SESSION_PACK_LOG="$ROOT/bun-pack-session-sync.log"
OPENAPI_PACK_LOG="$ROOT/bun-pack-openapi.log"
HELP_LOG_BUN="$ROOT/docker-git-help-bun.log"
TAR_LIST="$ROOT/tar-list.txt"
SESSION_TAR_LIST="$ROOT/session-tar-list.txt"
OPENAPI_TAR_LIST="$ROOT/openapi-tar-list.txt"
PACKED_TARBALL=""
SESSION_PACKED_TARBALL=""
OPENAPI_PACKED_TARBALL=""
PACKAGE_JSON="$REPO_ROOT/packages/app/package.json"
PACKAGE_JSON_BACKUP="$ROOT/package.json.backup"

fail() {
  echo "e2e/local-package-cli: $*" >&2
  exit 1
}

on_error() {
  local line="$1"
  echo "e2e/local-package-cli: failed at line $line" >&2
  if [[ -f "$PACK_LOG" ]]; then
    echo "--- bun pack log ---" >&2
    cat "$PACK_LOG" >&2 || true
  fi
  if [[ -f "$SESSION_PACK_LOG" ]]; then
    echo "--- bun pack session sync log ---" >&2
    cat "$SESSION_PACK_LOG" >&2 || true
  fi
  if [[ -f "$OPENAPI_PACK_LOG" ]]; then
    echo "--- bun pack openapi log ---" >&2
    cat "$OPENAPI_PACK_LOG" >&2 || true
  fi
  if [[ -f "$HELP_LOG_BUN" ]]; then
    echo "--- bun run docker-git --help log ---" >&2
    cat "$HELP_LOG_BUN" >&2 || true
  fi
}

cleanup() {
  if [[ -f "$PACKAGE_JSON_BACKUP" ]]; then
    cp "$PACKAGE_JSON_BACKUP" "$PACKAGE_JSON" >/dev/null 2>&1 || true
  fi
  if [[ "$KEEP" == "1" ]]; then
    echo "e2e/local-package-cli: KEEP=1 set; preserving temp dir: $ROOT" >&2
    return
  fi
  if [[ -n "$PACKED_TARBALL" ]] && [[ -f "$PACKED_TARBALL" ]]; then
    rm -f "$PACKED_TARBALL" >/dev/null 2>&1 || true
  fi
  if [[ -n "$SESSION_PACKED_TARBALL" ]] && [[ -f "$SESSION_PACKED_TARBALL" ]]; then
    rm -f "$SESSION_PACKED_TARBALL" >/dev/null 2>&1 || true
  fi
  if [[ -n "$OPENAPI_PACKED_TARBALL" ]] && [[ -f "$OPENAPI_PACKED_TARBALL" ]]; then
    rm -f "$OPENAPI_PACKED_TARBALL" >/dev/null 2>&1 || true
  fi
  rm -rf "$ROOT" >/dev/null 2>&1 || true
}

trap 'on_error $LINENO' ERR
trap cleanup EXIT

dg_prepare_docker_git_cli "$REPO_ROOT" "$ROOT/.e2e-bin"

cd "$REPO_ROOT/packages/docker-git-session-sync"
bun run build >/dev/null
SESSION_PACKED_TARBALL="$(bun pm pack --quiet --ignore-scripts --destination "$ROOT" | tee "$SESSION_PACK_LOG" | tail -n 1 | tr -d '\r')"
[[ -n "$SESSION_PACKED_TARBALL" ]] || fail "bun pm pack did not return session sync tarball path"
[[ -f "$SESSION_PACKED_TARBALL" ]] || fail "packed session sync tarball not found: $SESSION_PACKED_TARBALL"

tar -tf "$SESSION_PACKED_TARBALL" >"$SESSION_TAR_LIST"
grep -Fq -- "package/dist/docker-git-session-sync.js" "$SESSION_TAR_LIST" \
  || fail "packed session sync tarball does not include dist/docker-git-session-sync.js"

session_entry_tmp="$ROOT/session-entry.js"
tar -xOf "$SESSION_PACKED_TARBALL" package/dist/docker-git-session-sync.js >"$session_entry_tmp"
session_first_line="$(head -n 1 "$session_entry_tmp" | tr -d '\r')"
[[ "$session_first_line" == "#!/usr/bin/env bun" ]] \
  || fail "packed session sync entrypoint missing shebang: expected '#!/usr/bin/env bun', got '$session_first_line'"

cd "$REPO_ROOT/packages/openapi"
OPENAPI_PACKED_TARBALL="$(bun pm pack --quiet --ignore-scripts --destination "$ROOT" | tee "$OPENAPI_PACK_LOG" | tail -n 1 | tr -d '\r')"
[[ -n "$OPENAPI_PACKED_TARBALL" ]] || fail "bun pm pack did not return openapi tarball path"
[[ -f "$OPENAPI_PACKED_TARBALL" ]] || fail "packed openapi tarball not found: $OPENAPI_PACKED_TARBALL"

tar -tf "$OPENAPI_PACKED_TARBALL" >"$OPENAPI_TAR_LIST"
grep -Fq -- "package/src/index.ts" "$OPENAPI_TAR_LIST" \
  || fail "packed openapi tarball does not include src/index.ts"
grep -Fq -- "package/openapi.json" "$OPENAPI_TAR_LIST" \
  || fail "packed openapi tarball does not include openapi.json"

cp "$PACKAGE_JSON" "$PACKAGE_JSON_BACKUP"
SESSION_PACKED_TARBALL="$SESSION_PACKED_TARBALL" OPENAPI_PACKED_TARBALL="$OPENAPI_PACKED_TARBALL" bun -e 'import { readFileSync, writeFileSync } from "node:fs"; const path = process.argv[1]; const pkg = JSON.parse(readFileSync(path, "utf8")); delete pkg.devDependencies; pkg.dependencies = pkg.dependencies ?? {}; pkg.dependencies["@prover-coder-ai/docker-git-session-sync"] = `file:${process.env.SESSION_PACKED_TARBALL}`; pkg.dependencies["@prover-coder-ai/docker-git-openapi"] = `file:${process.env.OPENAPI_PACKED_TARBALL}`; writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");' "$PACKAGE_JSON"

cd "$REPO_ROOT/packages/app"
PACKED_TARBALL="$(bun pm pack --quiet --ignore-scripts --destination "$ROOT" | tee "$PACK_LOG" | tail -n 1 | tr -d '\r')"
[[ -n "$PACKED_TARBALL" ]] || fail "bun pm pack did not return tarball path"
[[ -f "$PACKED_TARBALL" ]] || fail "packed tarball not found: $PACKED_TARBALL"
cp "$PACKAGE_JSON_BACKUP" "$PACKAGE_JSON"

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

grep -Fq -- "package/dist/src/docker-git/main.js" "$TAR_LIST" \
  || fail "packed tarball does not include dist/src/docker-git/main.js"

main_entry_tmp="$ROOT/main-entry.js"
tar -xOf "$PACKED_TARBALL" package/dist/src/docker-git/main.js >"$main_entry_tmp"
main_first_line="$(head -n 1 "$main_entry_tmp" | tr -d '\r')"
[[ "$main_first_line" == "#!/usr/bin/env bun" ]] \
  || fail "packed CLI entrypoint missing shebang: expected '#!/usr/bin/env bun', got '$main_first_line'"

dep_keys="$(tar -xOf "$PACKED_TARBALL" package/package.json | bun -e 'const s = await Bun.stdin.text(); const pkg = JSON.parse(s); const deps = Object.keys(pkg.dependencies ?? {}); if (deps.includes("@effect-template/lib")) { console.error("@effect-template/lib must not be a runtime dependency in packed package"); process.exit(1) } process.stdout.write(deps.join(","));')"
[[ "$dep_keys" == *"effect"* ]] || fail "packed dependency set looks invalid: $dep_keys"

mkdir -p "$ROOT/project"
cd "$ROOT/project"
bun init -y >/dev/null 2>&1
bun add "$PACKED_TARBALL" --silent
bun run docker-git --help >"$HELP_LOG_BUN" 2>&1

grep -Fq -- "docker-git clone <url> [options]" "$HELP_LOG_BUN" \
  || fail "expected docker-git help output via Bun from local packed package"

echo "e2e/local-package-cli: local tarball install + Bun CLI execution OK" >&2
