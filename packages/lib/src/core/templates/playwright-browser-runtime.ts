const playwrightBrowserRuntimeScript = String.raw`#!/usr/bin/env bash
set -euo pipefail

docker_git_browser_log() {
  printf '%s\n' "[docker-git-browser] $*" >&2
}

docker_git_browser_has_docker() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

docker_git_browser_context_dir() {
  printf '%s\n' "\${DOCKER_GIT_BROWSER_CONTEXT_DIR:-/opt/docker-git/browser}"
}

docker_git_stop_playwright_browser() {
  local container_name="\${DOCKER_GIT_BROWSER_CONTAINER_NAME:-}"
  if [[ -z "$container_name" ]]; then
    return 0
  fi
  if ! docker_git_browser_has_docker; then
    return 0
  fi
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}

docker_git_start_playwright_browser() {
  if [[ "\${MCP_PLAYWRIGHT_ENABLE:-0}" != "1" ]]; then
    docker_git_stop_playwright_browser || true
    return 0
  fi

  local container_name="\${DOCKER_GIT_BROWSER_CONTAINER_NAME:-}"
  local image_name="\${DOCKER_GIT_BROWSER_IMAGE_NAME:-}"
  local volume_name="\${DOCKER_GIT_BROWSER_VOLUME_NAME:-}"
  local main_container="\${DOCKER_GIT_PROJECT_CONTAINER_NAME:-}"
  local context_dir
  context_dir="$(docker_git_browser_context_dir)"

  if [[ -z "$container_name" || -z "$image_name" || -z "$volume_name" || -z "$main_container" ]]; then
    docker_git_browser_log "missing browser runtime configuration; skipping nested browser start"
    return 0
  fi
  if ! docker_git_browser_has_docker; then
    docker_git_browser_log "Docker API is unavailable; skipping nested browser start"
    return 0
  fi
  if [[ ! -f "$context_dir/Dockerfile.browser" ]]; then
    docker_git_browser_log "browser Dockerfile is missing at $context_dir/Dockerfile.browser"
    return 0
  fi

  docker_git_browser_log "building $image_name"
  docker build -t "$image_name" -f "$context_dir/Dockerfile.browser" "$context_dir" >/var/log/docker-git-browser-build.log 2>&1 || {
    docker_git_browser_log "browser image build failed; see /var/log/docker-git-browser-build.log"
    return 0
  }

  docker_git_stop_playwright_browser || true
  docker volume create "$volume_name" >/dev/null

  local args=(
    run
    -d
    --name "$container_name"
    --label "docker-git.browser=1"
    --label "docker-git.project-container=$main_container"
    --network "container:$main_container"
    --shm-size "2g"
    -e "VNC_NOPW=1"
    -e "MCP_PLAYWRIGHT_CDP_GUARD=\${MCP_PLAYWRIGHT_CDP_GUARD:-1}"
    -e "MCP_PLAYWRIGHT_BLOCK_BROWSER_CLOSE=\${MCP_PLAYWRIGHT_BLOCK_BROWSER_CLOSE:-1}"
    -v "$volume_name:/data"
  )

  if [[ -n "\${DOCKER_GIT_BROWSER_CPU_LIMIT:-}" ]]; then
    args+=(--cpus "$DOCKER_GIT_BROWSER_CPU_LIMIT")
  fi
  if [[ -n "\${DOCKER_GIT_BROWSER_RAM_LIMIT:-}" ]]; then
    args+=(--memory "$DOCKER_GIT_BROWSER_RAM_LIMIT" --memory-swap "$DOCKER_GIT_BROWSER_RAM_LIMIT")
  fi

  docker_git_browser_log "starting $container_name inside $main_container network namespace"
  docker "\${args[@]}" "$image_name" >/dev/null || {
    docker_git_browser_log "failed to start $container_name"
    return 0
  }
}
`

// CHANGE: manage the Playwright browser as a nested Docker container owned by the project container.
// WHY: issue #306 follow-up requires browser containers to inherit project lifecycle while keeping separate limits.
// QUOTE(ТЗ): "пусть он поднимается внутри dg-issues1 а не где-то из вне"
// REF: issue-306-browser-nested-runtime
// SOURCE: n/a
// FORMAT THEOREM: start(main) -> running(browser) with network(browser) = container:main OR logged_warning
// PURITY: SHELL
// EFFECT: shell commands executed by generated entrypoint
// INVARIANT: browser data volume is preserved; runtime cleanup removes only the browser container
// COMPLEXITY: O(build + docker-run)/O(1)
export const renderPlaywrightBrowserRuntime = (): string => playwrightBrowserRuntimeScript
