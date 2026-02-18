#!/usr/bin/env bash
set -euo pipefail

# Shared helpers for docker-git E2E scripts (non-interactive).

dg_has_docker_access() {
  docker ps >/dev/null 2>&1
}

dg_has_sudo_docker_access() {
  sudo -n docker ps >/dev/null 2>&1
}

dg_install_docker_wrapper() {
  local bin_dir="$1"

  mkdir -p "$bin_dir"
  cat > "$bin_dir/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exec sudo -n docker "$@"
EOF
  chmod +x "$bin_dir/docker"
}

# Write a file to the Docker daemon host filesystem (useful when the Docker
# daemon cannot see the caller's local filesystem paths, but bind mounts still
# need real file contents).
#
# Usage:
#   echo "data" | dg_write_docker_host_file "/abs/path/on/host/file" 600
dg_write_docker_host_file() {
  local host_path="$1"
  local mode="${2:-}"

  local host_dir
  local host_name
  host_dir="$(dirname "$host_path")"
  host_name="$(basename "$host_path")"

  if [[ -n "$mode" ]] && [[ ! "$mode" =~ ^[0-7]{3,4}$ ]]; then
    echo "e2e: invalid file mode: $mode" >&2
    return 1
  fi

  if [[ -n "$mode" ]]; then
    docker run --rm -i -v "$host_dir":/mnt ubuntu:24.04 \
      bash -lc "cat > \"/mnt/$host_name\" && chmod \"$mode\" \"/mnt/$host_name\""
    return 0
  fi

  docker run --rm -i -v "$host_dir":/mnt ubuntu:24.04 \
    bash -lc "cat > \"/mnt/$host_name\""
}

# Ensure the calling script can run `docker` (and therefore docker-git) in a
# non-interactive environment. If the current user lacks access to the docker
# socket, but `sudo -n docker` works, install a `docker` wrapper earlier in PATH.
dg_ensure_docker() {
  local bin_dir="$1"

  if dg_has_docker_access; then
    return 0
  fi

  if dg_has_sudo_docker_access; then
    dg_install_docker_wrapper "$bin_dir"
    export PATH="$bin_dir:$PATH"
    return 0
  fi

  echo "e2e: docker is not accessible (docker ps failed; sudo -n docker ps also failed)" >&2
  return 1
}
