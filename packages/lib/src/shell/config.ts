import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import * as TreeFormatter from "@effect/schema/TreeFormatter"
import { Effect, Either } from "effect"

import { defaultTemplateConfig, type ProjectConfig } from "../core/domain.js"
import { ConfigDecodeError, ConfigNotFoundError } from "./errors.js"
import { resolveBaseDir } from "./paths.js"

const TemplateConfigSchema = Schema.Struct({
  containerName: Schema.String,
  serviceName: Schema.String,
  sshUser: Schema.String,
  sshPort: Schema.Number.pipe(Schema.int()),
  repoUrl: Schema.String,
  repoRef: Schema.String,
  gitTokenLabel: Schema.optional(Schema.String),
  targetDir: Schema.String,
  volumeName: Schema.String,
  dockerGitPath: Schema.optionalWith(Schema.String, {
    default: () => defaultTemplateConfig.dockerGitPath
  }),
  authorizedKeysPath: Schema.String,
  envGlobalPath: Schema.optionalWith(Schema.String, {
    default: () => defaultTemplateConfig.envGlobalPath
  }),
  envProjectPath: Schema.optionalWith(Schema.String, {
    default: () => defaultTemplateConfig.envProjectPath
  }),
  codexAuthPath: Schema.String,
  codexSharedAuthPath: Schema.optionalWith(Schema.String, {
    default: () => defaultTemplateConfig.codexSharedAuthPath
  }),
  codexHome: Schema.String,
  enableMcpPlaywright: Schema.optionalWith(Schema.Boolean, {
    default: () => defaultTemplateConfig.enableMcpPlaywright
  }),
  pnpmVersion: Schema.String
})

const ProjectConfigSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  template: TemplateConfigSchema
})

const ProjectConfigJsonSchema = Schema.parseJson(ProjectConfigSchema)

const decodeProjectConfig = (
  path: string,
  input: string
): Effect.Effect<ProjectConfig, ConfigDecodeError> =>
  Either.match(ParseResult.decodeUnknownEither(ProjectConfigJsonSchema)(input), {
    onLeft: (issue) =>
      Effect.fail(
        new ConfigDecodeError({
          path,
          message: TreeFormatter.formatIssueSync(issue)
        })
      ),
    onRight: (value) => Effect.succeed(value)
  })

// CHANGE: read and decode docker-git.json from disk
// WHY: keep unknown inputs at the boundary and validate with schema
// QUOTE(ТЗ): "интерфейс в котором можно авторизировать все что мы хотим иметь"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall p: decode(read(p)) = cfg -> cfg.schemaVersion = 1
// PURITY: SHELL
// EFFECT: Effect<ProjectConfig, ConfigNotFoundError | ConfigDecodeError | PlatformError, FileSystem | Path>
// INVARIANT: unknown input never leaks past this boundary
// COMPLEXITY: O(n) where n = |file|
export const readProjectConfig = (
  baseDir: string
): Effect.Effect<
  ProjectConfig,
  ConfigNotFoundError | ConfigDecodeError | PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*(_) {
    const { fs, path, resolved } = yield* _(resolveBaseDir(baseDir))
    const configPath = path.join(resolved, "docker-git.json")

    const exists = yield* _(fs.exists(configPath))
    if (!exists) {
      return yield* _(Effect.fail(new ConfigNotFoundError({ path: configPath })))
    }

    const contents = yield* _(fs.readFileString(configPath))
    return yield* _(decodeProjectConfig(configPath, contents))
  })
