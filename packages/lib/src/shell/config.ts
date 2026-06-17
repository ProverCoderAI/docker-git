import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import * as TreeFormatter from "@effect/schema/TreeFormatter"
import { Effect, Either } from "effect"

import {
  defaultTemplateConfig,
  isUnixUsername,
  type ProjectConfig,
  sshUsernamePatternDescription
} from "../core/domain.js"
import { ConfigDecodeError, ConfigNotFoundError } from "./errors.js"
import { resolveBaseDir } from "./paths.js"

const HostnameSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(253),
  Schema.pattern(
    /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/u
  )
)

const TemplateConfigInputSchema = Schema.Struct({
  containerName: Schema.String,
  serviceName: Schema.String,
  sshUser: Schema.String,
  sshPort: Schema.Number.pipe(Schema.int()),
  repoUrl: Schema.String,
  repoRef: Schema.String,
  gitTokenLabel: Schema.optional(Schema.String),
  skipGithubAuth: Schema.optionalWith(Schema.Boolean, {
    default: () => defaultTemplateConfig.skipGithubAuth
  }),
  codexAuthLabel: Schema.optional(Schema.String),
  claudeAuthLabel: Schema.optional(Schema.String),
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
  geminiAuthLabel: Schema.optional(Schema.String),
  geminiAuthPath: Schema.optionalWith(Schema.String, {
    default: () => defaultTemplateConfig.geminiAuthPath
  }),
  geminiHome: Schema.optionalWith(Schema.String, {
    default: () => defaultTemplateConfig.geminiHome
  }),
  grokAuthLabel: Schema.optional(Schema.String),
  grokAuthPath: Schema.optionalWith(Schema.String, {
    default: () => defaultTemplateConfig.grokAuthPath
  }),
  grokHome: Schema.optionalWith(Schema.String, {
    default: () => defaultTemplateConfig.grokHome
  }),
  cpuLimit: Schema.optionalWith(Schema.String, {
    default: () => defaultTemplateConfig.cpuLimit
  }),
  ramLimit: Schema.optionalWith(Schema.String, {
    default: () => defaultTemplateConfig.ramLimit
  }),
  gpu: Schema.optionalWith(Schema.Literal("none", "all"), {
    default: () => defaultTemplateConfig.gpu
  }),
  dockerNetworkMode: Schema.optionalWith(Schema.Literal("shared", "project"), {
    default: () => defaultTemplateConfig.dockerNetworkMode
  }),
  dockerSharedNetworkName: Schema.optionalWith(Schema.String, {
    default: () => defaultTemplateConfig.dockerSharedNetworkName
  }),
  enableMcpPlaywright: Schema.optionalWith(Schema.Boolean, {
    default: () => defaultTemplateConfig.enableMcpPlaywright
  }),
  bunVersion: Schema.optional(Schema.String),
  pnpmVersion: Schema.optional(Schema.String),
  clonedOnHostname: Schema.optional(HostnameSchema)
})

type DecodedProjectConfigInput = Schema.Schema.Type<typeof ProjectConfigInputSchema>

const normalizeLegacyProjectConfig = (
  config: DecodedProjectConfigInput
): ProjectConfig => {
  const { bunVersion, pnpmVersion, ...template } = config.template
  return {
    schemaVersion: config.schemaVersion,
    template: {
      ...template,
      bunVersion: bunVersion ?? pnpmVersion ?? defaultTemplateConfig.bunVersion
    }
  }
}

const validateProjectConfig = (
  path: string,
  config: ProjectConfig
): Effect.Effect<ProjectConfig, ConfigDecodeError> =>
  isUnixUsername(config.template.sshUser)
    ? Effect.succeed(config)
    : Effect.fail(
      new ConfigDecodeError({
        path,
        message: `template.sshUser must match ${sshUsernamePatternDescription}`
      })
    )

const ProjectConfigInputSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  template: TemplateConfigInputSchema
})

const ProjectConfigJsonSchema = Schema.parseJson(ProjectConfigInputSchema)

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
    onRight: (value) => validateProjectConfig(path, normalizeLegacyProjectConfig(value))
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

    const isExists = yield* _(fs.exists(configPath))
    if (!isExists) {
      return yield* _(Effect.fail(new ConfigNotFoundError({ path: configPath })))
    }

    const contents = yield* _(fs.readFileString(configPath))
    return yield* _(decodeProjectConfig(configPath, contents))
  })
