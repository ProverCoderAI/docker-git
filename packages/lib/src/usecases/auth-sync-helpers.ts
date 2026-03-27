import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import { Effect, Either } from "effect"

type CopyDecision = "skip" | "copy"
type JsonPrimitive = boolean | number | string | null
type JsonValue = JsonPrimitive | JsonRecord | ReadonlyArray<JsonValue>
type JsonRecord = Readonly<{ [key: string]: JsonValue }>

const JsonValueSchema: Schema.Schema<JsonValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.Null,
    Schema.Boolean,
    Schema.String,
    Schema.JsonNumber,
    Schema.Array(JsonValueSchema),
    Schema.Record({ key: Schema.String, value: JsonValueSchema })
  )
)

const JsonRecordSchema: Schema.Schema<JsonRecord> = Schema.Record({
  key: Schema.String,
  value: JsonValueSchema
})

const JsonRecordFromStringSchema = Schema.parseJson(JsonRecordSchema)
const defaultEnvContents = "# docker-git env\n# KEY=value\n"
const codexConfigMarker = "# docker-git codex config"

// CHANGE: move model_context_window and model_auto_compact_token_limit to [profiles.longcontx]
// WHY: global context window settings apply to all models; profile-scoped settings allow opt-in
// QUOTE(ТЗ): "добавь longcontx"
// REF: github-issue-183
// SOURCE: n/a
// FORMAT THEOREM: ∀c: config(c) -> model(c)="gpt-5.4" ∧ reasoning(c)=xhigh ∧ longcontx_profile(c)=defined
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: default config stays deterministic; longcontx profile always present
// COMPLEXITY: O(1)
export const defaultCodexConfig = [
  "# docker-git codex config",
  "model = \"gpt-5.4\"",
  "model_reasoning_effort = \"xhigh\"",
  "plan_mode_reasoning_effort = \"xhigh\"",
  "personality = \"pragmatic\"",
  "",
  "approval_policy = \"never\"",
  "sandbox_mode = \"danger-full-access\"",
  "web_search = \"live\"",
  "",
  "[features]",
  "shell_snapshot = true",
  "multi_agent = true",
  "apps = true",
  "shell_tool = true",
  "",
  "[profiles.longcontx]",
  "model = \"gpt-5.4\"",
  "model_context_window = 1050000",
  "model_auto_compact_token_limit = 945000",
  "model_reasoning_effort = \"xhigh\"",
  "plan_mode_reasoning_effort = \"xhigh\""
].join("\n")

export const resolvePathFromBase = (
  path: {
    readonly isAbsolute: (targetPath: string) => boolean
    readonly resolve: (...parts: ReadonlyArray<string>) => string
  },
  baseDir: string,
  targetPath: string
): string => path.isAbsolute(targetPath) ? targetPath : path.resolve(baseDir, targetPath)

const isPermissionDeniedSystemError = (error: PlatformError): boolean =>
  error._tag === "SystemError" && error.reason === "PermissionDenied"

export const skipCodexConfigPermissionDenied = (
  configPath: string,
  error: PlatformError
): Effect.Effect<void, PlatformError> =>
  isPermissionDeniedSystemError(error)
    ? Effect.logWarning(
      `Skipped Codex config sync at ${configPath}: permission denied (${error.description ?? "no details"}).`
    )
    : Effect.fail(error)

const normalizeConfigText = (text: string): string =>
  text
    .replaceAll("\r\n", "\n")
    .trim()

export const shouldRewriteDockerGitCodexConfig = (existing: string): boolean => {
  const normalized = normalizeConfigText(existing)
  if (normalized.length === 0) {
    return true
  }
  if (!normalized.startsWith(codexConfigMarker)) {
    return false
  }
  return normalized !== normalizeConfigText(defaultCodexConfig)
}

export const shouldCopyEnv = (sourceText: string, targetText: string): CopyDecision => {
  if (sourceText.trim().length === 0) {
    return "skip"
  }
  if (targetText.trim().length === 0) {
    return "copy"
  }
  if (targetText.trim() === defaultEnvContents.trim() && sourceText.trim() !== defaultEnvContents.trim()) {
    return "copy"
  }
  return "skip"
}

export const parseJsonRecord = (text: string): Effect.Effect<JsonRecord | null> =>
  Either.match(ParseResult.decodeUnknownEither(JsonRecordFromStringSchema)(text), {
    onLeft: () => Effect.succeed(null),
    onRight: (record) => Effect.succeed(record)
  })

export const hasClaudeOauthAccount = (record: JsonRecord | null): boolean =>
  record !== null && typeof record["oauthAccount"] === "object" && record["oauthAccount"] !== null

export const hasClaudeCredentials = (record: JsonRecord | null): boolean =>
  record !== null && typeof record["claudeAiOauth"] === "object" && record["claudeAiOauth"] !== null

export const isGithubTokenKey = (key: string): boolean =>
  key === "GITHUB_TOKEN" || key === "GH_TOKEN" || key.startsWith("GITHUB_TOKEN__")

export const hasNonEmptyFile = (
  fs: FileSystem.FileSystem,
  filePath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const exists = yield* _(fs.exists(filePath))
    if (!exists) {
      return false
    }

    const info = yield* _(fs.stat(filePath))
    if (info.type !== "File") {
      return false
    }

    const text = yield* _(fs.readFileString(filePath), Effect.orElseSucceed(() => ""))
    return text.trim().length > 0
  })

export type AuthPaths = {
  readonly envGlobalPath: string
  readonly envProjectPath: string
  readonly codexAuthPath: string
  readonly claudeAuthPath: string
}

export type AuthSyncSpec = {
  readonly sourceBase: string
  readonly targetBase: string
  readonly source: AuthPaths
  readonly target: AuthPaths
}

export type LegacyOrchPaths = AuthPaths & {
  readonly ghAuthPath: string
  readonly geminiAuthPath?: string
}
