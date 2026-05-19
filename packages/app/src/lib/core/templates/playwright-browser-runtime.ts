/* jscpd:ignore-start */
const playwrightBrowserRuntimeScript = `#!/usr/bin/env bash
set -euo pipefail

declare -a DOCKER_GIT_BROWSER_TEMP_FILES=()

docker_git_browser_log() {
  printf '%s\\n' "[docker-git-browser] $*" >&2
}

docker_git_browser_cleanup_temp_files() {
  if (( \${#DOCKER_GIT_BROWSER_TEMP_FILES[@]} > 0 )); then
    rm -f -- "\${DOCKER_GIT_BROWSER_TEMP_FILES[@]}" || true
  fi
}

docker_git_browser_register_temp_file() {
  DOCKER_GIT_BROWSER_TEMP_FILES+=("$1")
  trap docker_git_browser_cleanup_temp_files EXIT
}

docker_git_browser_has_docker() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

docker_git_browser_context_dir() {
  printf '%s\\n' "\${DOCKER_GIT_BROWSER_CONTEXT_DIR:-/opt/docker-git/browser}"
}

docker_git_disable_playwright_mcp() {
  docker_git_browser_log "$1; disabling Playwright MCP for this container start"
  MCP_PLAYWRIGHT_ENABLE=0
  export MCP_PLAYWRIGHT_ENABLE
}

docker_git_playwright_cdp_endpoint() {
  printf '%s\\n' "http://127.0.0.1:9223"
}

docker_git_fetch_playwright_cdp_version() {
  local endpoint
  endpoint="$(docker_git_playwright_cdp_endpoint)"
  curl -sSf --connect-timeout 3 --max-time 10 -H 'Host: 127.0.0.1:9222' "\${endpoint%/}/json/version" >/dev/null 2>&1
}

docker_git_wait_for_playwright_cdp() {
  local attempts="\${MCP_PLAYWRIGHT_READY_ATTEMPTS:-60}"
  local delay="\${MCP_PLAYWRIGHT_READY_DELAY:-1}"
  local endpoint
  endpoint="$(docker_git_playwright_cdp_endpoint)"
  if [[ ! "$attempts" =~ ^[0-9]+$ ]] || (( attempts < 1 )); then
    docker_git_browser_log "invalid MCP_PLAYWRIGHT_READY_ATTEMPTS=$attempts; using 60"
    attempts=60
  fi
  if [[ ! "$delay" =~ ^[0-9]+$ ]]; then
    docker_git_browser_log "invalid MCP_PLAYWRIGHT_READY_DELAY=$delay; using 1"
    delay=1
  fi

  local attempt=1
  while (( attempt <= attempts )); do
    if docker_git_fetch_playwright_cdp_version; then
      docker_git_browser_log "CDP endpoint is ready: $endpoint"
      return 0
    fi
    if (( attempt < attempts )); then
      docker_git_browser_log "waiting for CDP endpoint $endpoint (attempt $attempt/$attempts)"
      sleep "$delay"
    fi
    attempt=$((attempt + 1))
  done

  docker_git_browser_log "CDP endpoint did not become ready: $endpoint"
  return 1
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

docker_git_cleanup_orphaned_playwright_browsers() {
  if ! docker_git_browser_has_docker; then
    return 0
  fi

  local browser_id
  while IFS= read -r browser_id; do
    if [[ -z "$browser_id" ]]; then
      continue
    fi

    local project_container
    project_container="$(docker inspect --format '{{ index .Config.Labels "docker-git.project-container" }}' "$browser_id" 2>/dev/null || true)"

    local project_running
    project_running="false"
    if [[ -n "$project_container" && "$project_container" != "<no value>" ]]; then
      project_running="$(docker inspect --format '{{ .State.Running }}' "$project_container" 2>/dev/null || true)"
    fi

    if [[ "$project_running" == "true" ]]; then
      continue
    fi

    local browser_name
    browser_name="$(docker inspect --format '{{ .Name }}' "$browser_id" 2>/dev/null | sed 's#^/##' || true)"
    docker_git_browser_log "removing orphaned browser container \${browser_name:-$browser_id}"
    docker rm -f "$browser_id" >/dev/null 2>&1 || true
  done < <(docker ps -a -q --filter "label=docker-git.browser=1" --filter "label=docker-git.project-container")
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
    docker_git_disable_playwright_mcp "missing browser runtime configuration"
    return 0
  fi
  if ! docker_git_browser_has_docker; then
    docker_git_disable_playwright_mcp "Docker API is unavailable"
    return 0
  fi
  if [[ ! -f "$context_dir/Dockerfile.browser" ]]; then
    docker_git_disable_playwright_mcp "browser Dockerfile is missing at $context_dir/Dockerfile.browser"
    return 0
  fi

  docker_git_stop_playwright_browser || true
  docker_git_cleanup_orphaned_playwright_browsers || true

  local build_log
  if ! build_log="$(mktemp "\${TMPDIR:-/tmp}/docker-git-browser-build.XXXXXX.log" 2>/dev/null)"; then
    docker_git_disable_playwright_mcp "failed to create browser build log"
    return 0
  fi
  docker_git_browser_register_temp_file "$build_log"

  local build_timeout
  build_timeout="\${DOCKER_GIT_BROWSER_BUILD_TIMEOUT_SECONDS:-600}"

  docker_git_browser_log "building $image_name"
  timeout "$build_timeout" docker build -t "$image_name" -f "$context_dir/Dockerfile.browser" "$context_dir" >"$build_log" 2>&1 || {
    docker_git_browser_log "browser image build failed or timed out after \${build_timeout}s; output follows"
    cat "$build_log" >&2 || true
    docker_git_browser_log "browser image build log path before cleanup: $build_log"
    docker_git_disable_playwright_mcp "browser image build failed"
    return 0
  }
  rm -f -- "$build_log"

  if ! docker volume create "$volume_name" >/dev/null 2>&1; then
    docker_git_browser_log "failed to create browser data volume $volume_name; continuing"
  fi

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
    docker_git_disable_playwright_mcp "failed to start $container_name"
    return 0
  }

  docker_git_wait_for_playwright_cdp || {
    docker_git_disable_playwright_mcp "nested browser started but CDP is unavailable"
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
// INVARIANT: browser data volume is preserved; runtime cleanup removes only browser-labeled containers
// COMPLEXITY: O(b + build + docker-run)/O(1), where b = browser-labeled containers
export const renderPlaywrightBrowserRuntime = (): string => playwrightBrowserRuntimeScript
/* jscpd:ignore-end */
