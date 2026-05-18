import type { TemplateConfig } from "../domain.js"

// CHANGE: source and start the nested browser runtime from the main project entrypoint.
// WHY: issue #306 follow-up requires dg-*-browser to be owned by dg-* lifecycle, not a host-compose sibling.
// QUOTE(ТЗ): "раз это браузер контейнер от нашего контейнера то хотелось бы что бы он внутри нашего контейрнера и поднимался бы"
// REF: issue-306-browser-nested-runtime
// SOURCE: n/a
// FORMAT THEOREM: enable_mcp_playwright(project) -> entrypoint(project) attempts nested_browser_start(project)
// PURITY: SHELL
// EFFECT: sourced shell functions may call Docker when enabled
// INVARIANT: stop function is always defined before sshd lifecycle traps are installed
// COMPLEXITY: O(1)
export const renderEntrypointPlaywrightBrowserRuntime = (_config: TemplateConfig): string =>
  String.raw`# Nested Playwright browser runtime.  Defaults are no-ops so sshd cleanup can call them unconditionally.
docker_git_start_playwright_browser() { return 0; }
docker_git_stop_playwright_browser() { return 0; }

DOCKER_GIT_BROWSER_RUNTIME="/opt/docker-git/browser/docker-git-browser-runtime.sh"
if [[ -f "$DOCKER_GIT_BROWSER_RUNTIME" ]]; then
  # shellcheck disable=SC1090
  source "$DOCKER_GIT_BROWSER_RUNTIME"
fi

if [[ "$MCP_PLAYWRIGHT_ENABLE" == "1" ]]; then
  docker_git_start_playwright_browser || true
else
  docker_git_stop_playwright_browser || true
fi`
