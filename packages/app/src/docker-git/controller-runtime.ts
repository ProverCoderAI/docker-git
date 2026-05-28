export const controllerDockerRuntimeEnvKey = "DOCKER_GIT_DOCKER_RUNTIME"
export const projectDockerHostEnvKey = "DOCKER_GIT_PROJECT_DOCKER_HOST"
export const defaultIsolatedProjectDockerHost = "tcp://host.docker.internal:2375"

export type ControllerDockerRuntime = "host" | "isolated"

export const parseControllerDockerRuntime = (raw?: string): ControllerDockerRuntime | null => {
  const trimmed = raw?.trim() ?? ""
  if (trimmed.length === 0 || trimmed === "host") {
    return "host"
  }
  return trimmed === "isolated" ? "isolated" : null
}

export const resolveProjectDockerHostForRuntime = (
  runtime: ControllerDockerRuntime,
  rawProjectDockerHost?: string
): string =>
  runtime === "isolated"
    ? (rawProjectDockerHost?.trim() || defaultIsolatedProjectDockerHost)
    : (rawProjectDockerHost?.trim() ?? "")
