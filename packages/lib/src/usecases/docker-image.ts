import * as Command from "@effect/platform/Command"
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type { FileSystem } from "@effect/platform/FileSystem"
import type { Path } from "@effect/platform/Path"
import { Effect, pipe } from "effect"

import { runCommandWithExitCodes } from "../shell/command-runner.js"
import { CommandFailedError } from "../shell/errors.js"
import { resolvePathFromCwd } from "./path-helpers.js"

export type DockerImageSpec = {
  readonly imageName: string
  readonly imageDir: string
  readonly dockerfile: string
  readonly buildLabel: string
}

// CHANGE: ensure a docker image is available locally
// WHY: auth flows must not depend on external registry access
// QUOTE(ТЗ): "чтобы всё работало и поднималось"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall i: ensure(i) -> image_exists(i)
// PURITY: SHELL
// EFFECT: Effect<void, CommandFailedError | PlatformError, CommandExecutor>
// INVARIANT: image name is stable for docker-git auth
// COMPLEXITY: O(command)
export const ensureDockerImage = (
  fs: FileSystem,
  path: Path,
  cwd: string,
  spec: DockerImageSpec
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const imagePath = resolvePathFromCwd(path, cwd, spec.imageDir)
    const dockerfilePath = path.join(imagePath, "Dockerfile")
    const imageCheck = yield* _(
      pipe(
        Command.make("docker", "image", "inspect", spec.imageName),
        Command.workingDirectory(cwd),
        Command.stdout("pipe"),
        Command.stderr("pipe"),
        Command.exitCode,
        Effect.map(Number)
      )
    )
    const dockerfileExists = yield* _(fs.exists(dockerfilePath))
    const dockerfileMatches = yield* _(
      dockerfileExists
        ? Effect.gen(function*(__) {
          const info = yield* __(fs.stat(dockerfilePath))
          if (info.type !== "File") {
            return false
          }
          const current = yield* __(fs.readFileString(dockerfilePath))
          return current === spec.dockerfile
        })
        : Effect.succeed(false)
    )
    if (imageCheck === 0 && dockerfileMatches) {
      return
    }

    yield* _(fs.makeDirectory(imagePath, { recursive: true }))
    yield* _(fs.writeFileString(dockerfilePath, spec.dockerfile))
    yield* _(Effect.log(`Building ${spec.buildLabel} image (${spec.imageName})...`))
    yield* _(
      runCommandWithExitCodes(
        { cwd, command: "docker", args: ["build", "-t", spec.imageName, imagePath] },
        [0],
        (exitCode) => new CommandFailedError({ command: `docker build (${spec.buildLabel})`, exitCode })
      )
    )
  })
