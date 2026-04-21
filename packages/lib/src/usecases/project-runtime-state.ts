import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import { Effect, Either } from "effect"

export type ProjectRuntimeKnownStatus = "running" | "stopped" | "unknown"
export type ProjectRuntimeStartAction = "create" | "up" | "recreate" | "connect"

export type ProjectRuntimeState = {
  readonly lastStartedAtIso: string | null
  readonly lastStartedAtEpochMs: number | null
  readonly lastStartAction: ProjectRuntimeStartAction | null
  readonly lastKnownStatus: ProjectRuntimeKnownStatus
  readonly updatedAtIso: string | null
}

type ProjectRuntimeStateFile = ProjectRuntimeState & {
  readonly schemaVersion: 1
  readonly updatedAtIso: string
}

type RuntimeClock = {
  readonly iso: string
  readonly epochMs: number
}

export type RecordProjectRuntimeStartedInput = {
  readonly action: ProjectRuntimeStartAction
  readonly startedAtIso: string | null
  readonly startedAtEpochMs: number | null
}

const ProjectRuntimeKnownStatusSchema = Schema.Literal("running", "stopped", "unknown")
const ProjectRuntimeStartActionSchema = Schema.Literal("create", "up", "recreate", "connect")

const ProjectRuntimeStateFileSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  lastStartedAtIso: Schema.NullOr(Schema.String),
  lastStartedAtEpochMs: Schema.NullOr(Schema.Number),
  lastStartAction: Schema.NullOr(ProjectRuntimeStartActionSchema),
  lastKnownStatus: ProjectRuntimeKnownStatusSchema,
  updatedAtIso: Schema.String
})

const ProjectRuntimeStateFileJsonSchema = Schema.parseJson(ProjectRuntimeStateFileSchema)

export const projectRuntimeStateRelativePath: ReadonlyArray<string> = [".orch", "state", "runtime.json"]

export const emptyProjectRuntimeState = (): ProjectRuntimeState => ({
  lastStartedAtIso: null,
  lastStartedAtEpochMs: null,
  lastStartAction: null,
  lastKnownStatus: "unknown",
  updatedAtIso: null
})

const decodeProjectRuntimeStateFile = (
  input: string
): ProjectRuntimeStateFile | null =>
  Either.match(ParseResult.decodeUnknownEither(ProjectRuntimeStateFileJsonSchema)(input), {
    onLeft: () => null,
    onRight: (value) => value
  })

const resolveProjectRuntimeStatePath = (
  path: Path.Path,
  projectDir: string
): string => path.join(projectDir, ...projectRuntimeStateRelativePath)

const currentRuntimeClock = (): Effect.Effect<RuntimeClock> =>
  Effect.sync(() => {
    const now = new Date()
    return {
      iso: now.toISOString(),
      epochMs: now.getTime()
    }
  })

const finiteEpochOrNull = (value: number | null): number | null =>
  value === null || !Number.isFinite(value) ? null : value

const parseIsoEpochOrNull = (value: string): number | null => {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

const normalizeStartedAt = (
  input: RecordProjectRuntimeStartedInput,
  clock: RuntimeClock
): Pick<ProjectRuntimeStateFile, "lastStartedAtEpochMs" | "lastStartedAtIso"> => {
  const lastStartedAtIso = input.startedAtIso ?? clock.iso
  const lastStartedAtEpochMs = finiteEpochOrNull(input.startedAtEpochMs)
    ?? parseIsoEpochOrNull(lastStartedAtIso)
    ?? clock.epochMs

  return {
    lastStartedAtIso,
    lastStartedAtEpochMs
  }
}

const toRuntimeState = (
  fileState: ProjectRuntimeStateFile
): ProjectRuntimeState => ({
  lastStartedAtIso: fileState.lastStartedAtIso,
  lastStartedAtEpochMs: fileState.lastStartedAtEpochMs,
  lastStartAction: fileState.lastStartAction,
  lastKnownStatus: fileState.lastKnownStatus,
  updatedAtIso: fileState.updatedAtIso
})

const writeProjectRuntimeStateFile = (
  projectDir: string,
  state: ProjectRuntimeStateFile
): Effect.Effect<ProjectRuntimeStateFile, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const statePath = resolveProjectRuntimeStatePath(path, projectDir)

    yield* _(fs.makeDirectory(path.dirname(statePath), { recursive: true }))
    yield* _(fs.writeFileString(statePath, `${JSON.stringify(state, null, 2)}\n`))

    return state
  })

// CHANGE: read cached project runtime state from the `.docker-git` database
// WHY: Select/list sorting must use durable DB metadata without touching Docker containers
// QUOTE(ТЗ): "если запустили контейнер то сохранили эти данные в .docker-git"
// REF: user-message-2026-04-21-persist-runtime-state
// SOURCE: n/a
// FORMAT THEOREM: forall p: missing_or_invalid(runtime(p)) -> emptyRuntimeState
// PURITY: SHELL
// EFFECT: Effect<ProjectRuntimeState, never, FileSystem | Path>
// INVARIANT: invalid boundary JSON cannot escape into ProjectItem
// COMPLEXITY: O(n) where n = |runtime.json|
export const readProjectRuntimeState = (
  projectDir: string
): Effect.Effect<ProjectRuntimeState, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const statePath = resolveProjectRuntimeStatePath(path, projectDir)
    const exists = yield* _(fs.exists(statePath))
    if (!exists) {
      return emptyProjectRuntimeState()
    }

    const contents = yield* _(fs.readFileString(statePath))
    const decoded = decodeProjectRuntimeStateFile(contents)
    return decoded === null ? emptyProjectRuntimeState() : toRuntimeState(decoded)
  }).pipe(Effect.catchAll(() => Effect.succeed(emptyProjectRuntimeState())))

// CHANGE: persist successful runtime launches into project-local `.orch/state`
// WHY: DB-only project listing can still sort by latest launch time
// QUOTE(ТЗ): "если запустили контейнер то сохранили эти данные в .docker-git"
// REF: user-message-2026-04-21-persist-runtime-state
// SOURCE: n/a
// FORMAT THEOREM: forall launch: success(launch) -> lastKnownStatus(write(launch)) = running
// PURITY: SHELL
// EFFECT: Effect<ProjectRuntimeState, PlatformError, FileSystem | Path>
// INVARIANT: persisted timestamps are total; missing Docker StartedAt falls back to write time
// COMPLEXITY: O(1)
export const recordProjectRuntimeStarted = (
  projectDir: string,
  input: RecordProjectRuntimeStartedInput
): Effect.Effect<ProjectRuntimeState, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const clock = yield* _(currentRuntimeClock())
    const startedAt = normalizeStartedAt(input, clock)
    const fileState: ProjectRuntimeStateFile = {
      schemaVersion: 1,
      lastStartedAtIso: startedAt.lastStartedAtIso,
      lastStartedAtEpochMs: startedAt.lastStartedAtEpochMs,
      lastStartAction: input.action,
      lastKnownStatus: "running",
      updatedAtIso: clock.iso
    }

    const written = yield* _(writeProjectRuntimeStateFile(projectDir, fileState))
    return toRuntimeState(written)
  })

// CHANGE: persist explicit stops without erasing the latest successful launch timestamp
// WHY: cached status and launch ordering are distinct pieces of DB state
// QUOTE(ТЗ): ".docker-git это наша база данных можно скзаать"
// REF: user-message-2026-04-21-db-only-project-list
// SOURCE: n/a
// FORMAT THEOREM: forall p: stop(p) preserves lastStartedAt(p)
// PURITY: SHELL
// EFFECT: Effect<ProjectRuntimeState, PlatformError, FileSystem | Path>
// INVARIANT: stopped state never changes lastStartedAt* fields
// COMPLEXITY: O(n) where n = |runtime.json|
export const recordProjectRuntimeStopped = (
  projectDir: string
): Effect.Effect<ProjectRuntimeState, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const previous = yield* _(readProjectRuntimeState(projectDir))
    const clock = yield* _(currentRuntimeClock())
    const fileState: ProjectRuntimeStateFile = {
      schemaVersion: 1,
      lastStartedAtIso: previous.lastStartedAtIso,
      lastStartedAtEpochMs: previous.lastStartedAtEpochMs,
      lastStartAction: previous.lastStartAction,
      lastKnownStatus: "stopped",
      updatedAtIso: clock.iso
    }

    const written = yield* _(writeProjectRuntimeStateFile(projectDir, fileState))
    return toRuntimeState(written)
  })
