import { Effect } from "effect"

import {
  controllerDockerRuntimeEnvKey,
  parseControllerDockerRuntime,
  projectDockerHostEnvKey,
  resolveProjectDockerHostForRuntime
} from "./controller-runtime.js"
import { type ControllerBootstrapError, controllerBootstrapError } from "./host-errors.js"

// CHANGE: prepare controller runtime environment before docker compose bootstrap
// WHY: isolated controllers must pass a non-empty embedded daemon endpoint to project containers
// QUOTE(ТЗ): "исправить все уязвимости которые нашёл"
// REF: pr-351-review-isolated-runtime
// SOURCE: n/a
// FORMAT THEOREM: runtime=isolated -> projectDockerHost != ""
// PURITY: SHELL
// EFFECT: Effect<void, ControllerBootstrapError>
// INVARIANT: explicit DOCKER_GIT_PROJECT_DOCKER_HOST is preserved after trimming
// COMPLEXITY: O(1)
export const prepareControllerRuntimeEnv = (): Effect.Effect<void, ControllerBootstrapError> => {
  const rawRuntime = process.env[controllerDockerRuntimeEnvKey]
  const runtime = parseControllerDockerRuntime(rawRuntime)
  if (runtime === null) {
    return Effect.fail(
      controllerBootstrapError(
        `${controllerDockerRuntimeEnvKey} must be unset or one of: host, isolated. Received: ${rawRuntime ?? ""}`
      )
    )
  }

  return Effect.sync(() => {
    const projectDockerHost = resolveProjectDockerHostForRuntime(runtime, process.env[projectDockerHostEnvKey])
    if (projectDockerHost.length === 0) {
      Reflect.deleteProperty(process.env, projectDockerHostEnvKey)
      return
    }
    process.env[projectDockerHostEnvKey] = projectDockerHost
  })
}
