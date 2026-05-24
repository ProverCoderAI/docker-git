#!/usr/bin/env bash
set -euo pipefail

runtime="${DOCKER_GIT_DOCKER_RUNTIME:-host}"
docker_host="${DOCKER_HOST:-unix:///var/run/docker.sock}"
dockerd_pid=""

cleanup() {
  if [[ -n "$dockerd_pid" ]] && kill -0 "$dockerd_pid" >/dev/null 2>&1; then
    kill "$dockerd_pid" >/dev/null 2>&1 || true
    wait "$dockerd_pid" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

if [[ "$runtime" == "isolated" ]]; then
  if [[ "$docker_host" != unix://* ]]; then
    echo "DOCKER_GIT_DOCKER_RUNTIME=isolated requires a unix:// DOCKER_HOST for the managed controller daemon." >&2
    exit 1
  fi

  export DOCKER_HOST="$docker_host"

  socket_path="${docker_host#unix://}"
  data_root="${DOCKER_GIT_DOCKER_DATA_ROOT:-/var/lib/docker}"
  log_path="${DOCKER_GIT_DOCKERD_LOG:-/var/log/docker-git/dockerd.log}"
  tcp_host="${DOCKER_GIT_DOCKERD_TCP_HOST:-tcp://0.0.0.0:2375}"
  default_cgroupns_mode="${DOCKER_GIT_DOCKERD_DEFAULT_CGROUPNS_MODE:-host}"

  mkdir -p "$(dirname "$socket_path")" "$data_root" "$(dirname "$log_path")"

  if ! docker info >/dev/null 2>&1; then
    # shellcheck disable=SC2086
    dockerd \
      --host="$docker_host" \
      --host="$tcp_host" \
      --tls=false \
      --data-root="$data_root" \
      --exec-opt native.cgroupdriver=cgroupfs \
      --default-cgroupns-mode="$default_cgroupns_mode" \
      ${DOCKER_GIT_DOCKERD_ARGS:-} \
      >"$log_path" 2>&1 &
    dockerd_pid="$!"

    for _ in $(seq 1 90); do
      if docker info >/dev/null 2>&1; then
        break
      fi
      if ! kill -0 "$dockerd_pid" >/dev/null 2>&1; then
        echo "Managed Docker daemon exited during startup." >&2
        tail -n 200 "$log_path" >&2 || true
        exit 1
      fi
      sleep 1
    done

    if ! docker info >/dev/null 2>&1; then
      echo "Managed Docker daemon did not become ready in time." >&2
      tail -n 200 "$log_path" >&2 || true
      exit 1
    fi
  fi
fi

bun packages/api/dist/src/main.js &
api_pid="$!"
wait "$api_pid"
