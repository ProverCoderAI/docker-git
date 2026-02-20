#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cases=("$@")
if [[ "${#cases[@]}" -eq 0 ]]; then
  cases=("local-package-cli" "clone-cache" "login-context" "opencode-autoconnect")
fi

for case_name in "${cases[@]}"; do
  script_path="$SCRIPT_DIR/${case_name}.sh"
  if [[ ! -x "$script_path" ]]; then
    echo "e2e/run-all: missing executable script: $script_path" >&2
    exit 1
  fi
  echo "e2e/run-all: running ${case_name}..." >&2
  "$script_path"
  echo "e2e/run-all: ${case_name} OK" >&2
done

echo "e2e/run-all: all cases OK" >&2
