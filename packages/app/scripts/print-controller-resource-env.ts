import { NodeRuntime } from "@effect/platform-node"
import { Effect, Either } from "effect"

import {
  controllerCpuLimitEnvKey,
  controllerMemoryLimitEnvKey,
  controllerPidsLimitEnvKey,
  resolveControllerResourceLimitEnv
} from "../src/docker-git/controller-resource-limits.js"
import { formatParseError } from "../src/docker-git/frontend-lib/core/parse-errors.js"

const fallbackControllerHostResources = {
  cpuCount: 1,
  totalMemoryBytes: 1024 ** 3
}

const loadControllerHostResources = Effect.tryPromise({
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

const renderEnv = (
  env: {
    readonly cpus: string
    readonly memory: string
    readonly pids: string
  }
): string =>
  [
    `${controllerCpuLimitEnvKey}=${env.cpus}`,
    `${controllerMemoryLimitEnvKey}=${env.memory}`,
    `${controllerPidsLimitEnvKey}=${env.pids}`
  ].join("\n")

const program = Effect.gen(function*(_) {
  const hostResources = yield* _(loadControllerHostResources)
  const resolved = resolveControllerResourceLimitEnv(
    {
      cpuLimit: process.env[controllerCpuLimitEnvKey],
      ramLimit: process.env[controllerMemoryLimitEnvKey],
      pidsLimit: process.env[controllerPidsLimitEnvKey]
    },
    hostResources
  )

  if (Either.isLeft(resolved)) {
    return yield* _(Effect.fail(new Error(formatParseError(resolved.left))))
  }

  yield* _(
    Effect.sync(() => {
      process.stdout.write(renderEnv(resolved.right))
      process.stdout.write("\n")
    })
  )
})

NodeRuntime.runMain(program)
