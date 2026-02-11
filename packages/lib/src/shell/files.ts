import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect, Match } from "effect"

import { type TemplateConfig } from "../core/domain.js"
import { type FileSpec, planFiles } from "../core/templates.js"
import { FileExistsError } from "./errors.js"
import { resolveBaseDir } from "./paths.js"

const ensureParentDir = (path: Path.Path, fs: FileSystem.FileSystem, filePath: string) =>
  fs.makeDirectory(path.dirname(filePath), { recursive: true })

const writeSpec = (
  path: Path.Path,
  fs: FileSystem.FileSystem,
  baseDir: string,
  spec: FileSpec
) => {
  const fullPath = path.join(baseDir, spec.relativePath)

  return Match.value(spec).pipe(
    Match.when({ _tag: "Dir" }, () => fs.makeDirectory(fullPath, { recursive: true })),
    Match.when({ _tag: "File" }, (file) =>
      Effect.gen(function*(_) {
        yield* _(ensureParentDir(path, fs, fullPath))
        yield* _(
          fs.writeFileString(
            fullPath,
            file.contents,
            file.mode === undefined ? undefined : { mode: file.mode }
          )
        )
      })),
    Match.exhaustive
  )
}

// CHANGE: write generated docker-git files to disk
// WHY: isolate all filesystem effects in a thin shell
// QUOTE(ТЗ): "создавать докер образы"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall cfg, dir: write(plan(cfg), dir) -> files(dir, cfg)
// PURITY: SHELL
// EFFECT: Effect<ReadonlyArray<string>, FileExistsError | PlatformError, FileSystem | Path>
// INVARIANT: does not overwrite files unless force=true
// COMPLEXITY: O(n) where n = |files|
export const writeProjectFiles = (
  outDir: string,
  config: TemplateConfig,
  force: boolean,
  skipExistingFiles: boolean = false
): Effect.Effect<
  ReadonlyArray<string>,
  FileExistsError | PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*(_) {
    const { fs, path, resolved: baseDir } = yield* _(resolveBaseDir(outDir))

    yield* _(fs.makeDirectory(baseDir, { recursive: true }))

    const specs = planFiles(config)
    const created: Array<string> = []

    if (!force) {
      for (const spec of specs) {
        if (spec._tag === "File") {
          const filePath = path.join(baseDir, spec.relativePath)
          const exists = yield* _(fs.exists(filePath))
          if (exists) {
            if (skipExistingFiles) {
              continue
            }
            return yield* _(Effect.fail(new FileExistsError({ path: filePath })))
          }
        }
      }
    }

    for (const spec of specs) {
      if (!force && skipExistingFiles && spec._tag === "File") {
        const filePath = path.join(baseDir, spec.relativePath)
        const exists = yield* _(fs.exists(filePath))
        if (exists) {
          continue
        }
      }
      yield* _(writeSpec(path, fs, baseDir, spec))
      if (spec._tag === "File") {
        created.push(path.join(baseDir, spec.relativePath))
      }
    }

    return created
  })
