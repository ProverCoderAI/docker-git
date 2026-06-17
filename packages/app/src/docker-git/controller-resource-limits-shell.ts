import { Effect, Either } from "effect"

import {
  controllerCpuLimitEnvKey,
  controllerMemoryLimitEnvKey,
  controllerMemorySwapLimitEnvKey,
  controllerPidsLimitEnvKey,
  controllerResourceLimitsForceRecreateEnvKey,
  resolveControllerResourceLimitEnv
} from "./controller-resource-limits.js"
import { formatParseError } from "./frontend-lib/core/parse-errors.js"
import type { ControllerBootstrapError } from "./host-errors.js"

const controllerBootstrapError = (message: string): ControllerBootstrapError => ({
  _tag: "ControllerBootstrapError",
  message
})

const fallbackControllerHostResources = {
  cpuCount: 1,
  totalMemoryBytes: 1024 ** 3
}

const loadControllerHostResources = (): Effect.Effect<
  { readonly cpuCount: number; readonly totalMemoryBytes: number }
> =>
  Effect.tryPromise({
    try: () => import("node:os"),
    catch: (error) => new Error(String(error))
  }).pipe(
    Effect.map((os) => ({
      cpuCount: os.availableParallelism(),
      totalMemoryBytes: os.totalmem()
    })),
    Effect.match({
      onFailure: () => fallbackControllerHostResources,
      onSuccess: (value) => value
    })
  )

const currentControllerResourceLimitIntent = () => ({
  cpuLimit: process.env[controllerCpuLimitEnvKey],
  ramLimit: process.env[controllerMemoryLimitEnvKey],
  pidsLimit: process.env[controllerPidsLimitEnvKey]
})

export const shouldForceRecreateForControllerResourceLimits = (): boolean =>
  process.env[controllerResourceLimitsForceRecreateEnvKey]?.trim() === "1"

// CHANGE: resolve controller resource limits before invoking docker compose.
// WHY: compose requires concrete cpus/memory values, while docker-git accepts 90% defaults and percentage CLI/env intent.
// QUOTE(ТЗ): "по дефолту он должен иметь возможность к 90% лимитов"
// REF: issue-260-pr-comment-4429205358
// SOURCE: https://github.com/ProverCoderAI/docker-git/pull/263#issuecomment-4429205358
// FORMAT THEOREM: forall h: prepare(h) -> env(cpus,memory,pids) are compose-compatible
// PURITY: SHELL
// EFFECT: Effect<void, ControllerBootstrapError, never>
// INVARIANT: docker compose never receives percentage memory values
// COMPLEXITY: O(1)
export const prepareControllerResourceLimitEnv = (): Effect.Effect<void, ControllerBootstrapError> =>
  Effect.gen(function*(_) {
    const hostResources = yield* _(loadControllerHostResources())
    const resolved = resolveControllerResourceLimitEnv(currentControllerResourceLimitIntent(), hostResources)

    if (Either.isLeft(resolved)) {
      const message = [
        "Invalid docker-git controller resource limit.",
        formatParseError(resolved.left)
      ].join("\n")
      return yield* _(Effect.fail(controllerBootstrapError(message)))
    }

    yield* _(
      Effect.sync(() => {
        process.env[controllerCpuLimitEnvKey] = resolved.right.cpus
        process.env[controllerMemoryLimitEnvKey] = resolved.right.memory
        process.env[controllerMemorySwapLimitEnvKey] = resolved.right.memorySwap
        process.env[controllerPidsLimitEnvKey] = resolved.right.pids
      })
    )
  })
