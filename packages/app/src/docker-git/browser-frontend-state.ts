import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import { Effect, Either, pipe } from "effect"

import { computeRevisionFromInputs } from "./controller-revision.js"
import { defaultProjectsRoot, findExistingUpwards } from "./frontend-lib/usecases/path-helpers.js"

export type BrowserFrontendStateFile = {
  readonly schemaVersion: 1
  readonly revision: string
  readonly pid: string
  readonly host: string
  readonly port: string
  readonly apiBaseUrl: string
  readonly startedAtIso: string
}

export type BrowserFrontendStartDecision = {
  readonly shouldStartWeb: boolean
  readonly apiBaseUrl: string
  readonly host: string
  readonly port: string
  readonly statePath: string
  readonly webRevision: string
}

export type BrowserFrontendReuseInput = {
  readonly apiBaseUrl: string
  readonly host: string
  readonly port: string
  readonly revision: string
  readonly state: BrowserFrontendStateFile | null
  readonly webPids: ReadonlyArray<string>
}

const BrowserFrontendStateFileSchema: Schema.Schema<BrowserFrontendStateFile> = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  revision: Schema.String,
  pid: Schema.String,
  host: Schema.String,
  port: Schema.String,
  apiBaseUrl: Schema.String,
  startedAtIso: Schema.String
})

const BrowserFrontendStateFileJsonSchema = Schema.parseJson(BrowserFrontendStateFileSchema)

const browserFrontendRevisionInputs: ReadonlyArray<string> = [
  "package.json",
  "bun.lock",
  "bunfig.toml",
  "tsconfig.base.json",
  "packages/app/package.json",
  "packages/app/vite.web.config.ts",
  "packages/app/scripts/serve-dist-web.mjs",
  "packages/app/src/docker-git",
  "packages/app/src/lib",
  "packages/app/src/shared",
  "packages/app/src/ui",
  "packages/app/src/web"
]

const browserFrontendStateRelativePath: ReadonlyArray<string> = [".orch", "state", "browser-frontend.json"]

const resolveRepoRoot = (): Effect.Effect<string, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const composePath = yield* _(findExistingUpwards(fs, path, process.cwd(), "docker-compose.yml", 20))
    return composePath === null ? path.resolve(process.cwd()) : path.dirname(composePath)
  })

export const computeLocalBrowserFrontendRevision = (): Effect.Effect<
  string,
  PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  pipe(
    resolveRepoRoot(),
    Effect.flatMap((repoRoot) => computeRevisionFromInputs(repoRoot, browserFrontendRevisionInputs))
  )

export const resolveBrowserFrontendStatePath = (): Effect.Effect<string, never, Path.Path> =>
  Effect.gen(function*(_) {
    const path = yield* _(Path.Path)
    return path.join(defaultProjectsRoot(process.cwd()), ...browserFrontendStateRelativePath)
  })

const decodeBrowserFrontendStateFile = (
  input: string
): BrowserFrontendStateFile | null =>
  Either.match(ParseResult.decodeUnknownEither(BrowserFrontendStateFileJsonSchema)(input), {
    onLeft: () => null,
    onRight: (value) => value
  })

// CHANGE: read browser runtime state from `.docker-git` instead of probing project containers
// WHY: the browser command must decide idempotently from durable host-side metadata
// QUOTE(ТЗ): ".docker-git это наша база данных можно скзаать"
// REF: user-message-2026-04-21-browser-selective-restart
// SOURCE: n/a
// FORMAT THEOREM: invalid_or_missing(state) -> null
// PURITY: SHELL
// EFFECT: Effect<BrowserFrontendStateFile | null, never, FileSystem>
// INVARIANT: untrusted JSON never leaves the boundary unless it matches BrowserFrontendStateFileSchema
// COMPLEXITY: O(n) where n = |browser-frontend.json|
export const readBrowserFrontendState = (
  statePath: string
): Effect.Effect<BrowserFrontendStateFile | null, never, FileSystem.FileSystem> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const exists = yield* _(fs.exists(statePath))
    if (!exists) {
      return null
    }

    const contents = yield* _(fs.readFileString(statePath))
    return decodeBrowserFrontendStateFile(contents)
  }).pipe(Effect.catchAll(() => Effect.succeed(null)))

// CHANGE: make web reuse a pure predicate over durable state and observed listening pids
// WHY: reruns should restart only the changed browser runtime, not the whole stack
// QUOTE(ТЗ): "если код итоговы не изменился что бы он не перезапускал контейнер"
// REF: user-message-2026-04-21-browser-selective-restart
// SOURCE: n/a
// FORMAT THEOREM: reuse(input) -> running(pid(state)) and state.revision = local_revision and state.endpoint = desired_endpoint
// PURITY: CORE
// EFFECT: none
// INVARIANT: stale state without a currently listening pid is never reused
// COMPLEXITY: O(p) where p = |webPids|
export const shouldReuseBrowserFrontend = (input: BrowserFrontendReuseInput): boolean =>
  input.state !== null &&
  input.webPids.includes(input.state.pid) &&
  input.state.revision === input.revision &&
  input.state.host === input.host &&
  input.state.port === input.port &&
  input.state.apiBaseUrl === input.apiBaseUrl

export const describeBrowserFrontendRestartReason = (input: BrowserFrontendReuseInput): string => {
  if (input.state === null) {
    return input.webPids.length === 0
      ? "browser frontend is not running"
      : "browser frontend has no valid .docker-git runtime state"
  }
  if (!input.webPids.includes(input.state.pid)) {
    return `browser frontend pid ${input.state.pid} from .docker-git is not listening on port ${input.port}`
  }
  if (input.state.revision !== input.revision) {
    return `browser frontend revision changed: local ${input.revision}, runtime ${input.state.revision}`
  }
  if (input.state.host !== input.host || input.state.port !== input.port) {
    return `browser frontend endpoint changed: local ${input.host}:${input.port}, runtime ${input.state.host}:${input.state.port}`
  }
  if (input.state.apiBaseUrl !== input.apiBaseUrl) {
    return `browser frontend API target changed: local ${input.apiBaseUrl}, runtime ${input.state.apiBaseUrl}`
  }
  return "browser frontend is current"
}
