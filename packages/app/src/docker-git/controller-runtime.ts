export const controllerDockerRuntimeEnvKey = "DOCKER_GIT_DOCKER_RUNTIME"
export const projectDockerHostEnvKey = "DOCKER_GIT_PROJECT_DOCKER_HOST"
export const defaultIsolatedProjectDockerHost = "tcp://host.docker.internal:2375"

export type ControllerDockerRuntime = "host" | "isolated"

// CHANGE: parse and normalize the controller Docker runtime mode.
// WHY: controller startup must distinguish host-backed Docker from the isolated embedded daemon fallback.
// QUOTE(ТЗ): "Host-Docker-backed runtime is the intended default; isolated is opt-in fallback"
// REF: packages/api/README.md
// SOURCE: n/a
// FORMAT THEOREM: forall raw: empty(trim(raw)) or trim(raw)=host -> host; trim(raw)=isolated -> isolated; otherwise -> null
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: parseControllerDockerRuntime is deterministic over trimmed input.
// COMPLEXITY: O(1) time, O(1) space.
/**
 * Parses the controller Docker runtime mode from an environment value.
 *
 * @param raw - Raw `DOCKER_GIT_DOCKER_RUNTIME` value.
 * @returns `"host"` for empty or host mode, `"isolated"` for isolated mode, or `null` for invalid input.
 *
 * @pure true
 * @effect n/a
 * @invariant Empty input and `"host"` normalize to `"host"`; `"isolated"` normalizes to `"isolated"`; all other values return `null`.
 * @precondition `raw` is a finite string or `undefined`.
 * @postcondition The result is exactly `"host"`, `"isolated"`, or `null`.
 * @complexity O(1) time and O(1) space.
 * @throws Never
 */
export const parseControllerDockerRuntime = (raw?: string): ControllerDockerRuntime | null => {
  const trimmed = raw?.trim() ?? ""
  if (trimmed.length === 0 || trimmed === "host") {
    return "host"
  }
  return trimmed === "isolated" ? "isolated" : null
}

// CHANGE: resolve the project-container Docker endpoint from controller runtime mode.
// WHY: isolated controllers must inject a reachable embedded daemon endpoint, while host-backed mode keeps the host-socket default.
// QUOTE(ТЗ): "when isolated, project containers default to tcp://host.docker.internal:2375"
// REF: packages/api/README.md
// SOURCE: n/a
// FORMAT THEOREM: forall runtime, raw: runtime=isolated -> nonempty(trim(raw) or defaultIsolatedProjectDockerHost); runtime=host -> trim(raw) or empty
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: isolated runtime always returns a non-empty Docker host string.
// COMPLEXITY: O(1) time, O(1) space.
/**
 * Resolves the Docker host URL passed to project containers.
 *
 * @param runtime - Normalized controller runtime mode.
 * @param rawProjectDockerHost - Raw `DOCKER_GIT_PROJECT_DOCKER_HOST` override.
 * @returns The trimmed project Docker host, the isolated default endpoint, or an empty host-mode value.
 *
 * @pure true
 * @effect n/a
 * @invariant Isolated runtime returns a non-empty endpoint; host runtime returns the explicit endpoint or an empty string.
 * @precondition `runtime` is a valid `ControllerDockerRuntime`; `rawProjectDockerHost` is a finite string or `undefined`.
 * @postcondition Result is non-empty in isolated mode and preserves host-mode emptiness when no override exists.
 * @complexity O(1) time and O(1) space.
 * @throws Never
 */
export const resolveProjectDockerHostForRuntime = (
  runtime: ControllerDockerRuntime,
  rawProjectDockerHost?: string
): string =>
  runtime === "isolated"
    ? (rawProjectDockerHost?.trim() || defaultIsolatedProjectDockerHost)
    : (rawProjectDockerHost?.trim() ?? "")
