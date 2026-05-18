import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import { Effect, Either } from "effect"

export type ProjectRuntimeKnownStatus = "running" | "stopped" | "unknown"
export type ProjectRuntimeStartAction = "create" | "up" | "recreate" | "connect"
export type ProjectRuntimeActivityKind = "agent" | "interactive"
export type ProjectRuntimeResourceProfile = "normal" | "interactive-idle-throttled"
export type ProjectRuntimeStopReason = "manual" | "auto-suspend" | "down"

export type ProjectRuntimeState = {
  readonly lastStartedAtIso: string | null
  readonly lastStartedAtEpochMs: number | null
  readonly lastStartAction: ProjectRuntimeStartAction | null
  readonly lastKnownStatus: ProjectRuntimeKnownStatus
  readonly lastAgentSeenAtIso: string | null
  readonly lastAgentSeenAtEpochMs: number | null
  readonly lastInteractiveSeenAtIso: string | null
  readonly lastInteractiveSeenAtEpochMs: number | null
  readonly resourceProfile: ProjectRuntimeResourceProfile
  readonly lastStopReason: ProjectRuntimeStopReason | null
  readonly updatedAtIso: string | null
}

type ProjectRuntimeStateFile = {
  readonly schemaVersion: 1
  readonly lastStartedAtIso: string | null
  readonly lastStartedAtEpochMs: number | null
  readonly lastStartAction: ProjectRuntimeStartAction | null
  readonly lastKnownStatus: ProjectRuntimeKnownStatus
  readonly lastAgentSeenAtIso?: string | null | undefined
  readonly lastAgentSeenAtEpochMs?: number | null | undefined
  readonly lastInteractiveSeenAtIso?: string | null | undefined
  readonly lastInteractiveSeenAtEpochMs?: number | null | undefined
  readonly resourceProfile?: ProjectRuntimeResourceProfile | undefined
  readonly lastStopReason?: ProjectRuntimeStopReason | null | undefined
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
const ProjectRuntimeResourceProfileSchema = Schema.Literal("normal", "interactive-idle-throttled")
const ProjectRuntimeStopReasonSchema = Schema.Literal("manual", "auto-suspend", "down")

const ProjectRuntimeStateFileSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  lastStartedAtIso: Schema.NullOr(Schema.String),
  lastStartedAtEpochMs: Schema.NullOr(Schema.Number),
  lastStartAction: Schema.NullOr(ProjectRuntimeStartActionSchema),
  lastKnownStatus: ProjectRuntimeKnownStatusSchema,
  lastAgentSeenAtIso: Schema.optional(Schema.NullOr(Schema.String)),
  lastAgentSeenAtEpochMs: Schema.optional(Schema.NullOr(Schema.Number)),
  lastInteractiveSeenAtIso: Schema.optional(Schema.NullOr(Schema.String)),
  lastInteractiveSeenAtEpochMs: Schema.optional(Schema.NullOr(Schema.Number)),
  resourceProfile: Schema.optional(ProjectRuntimeResourceProfileSchema),
  lastStopReason: Schema.optional(Schema.NullOr(ProjectRuntimeStopReasonSchema)),
  updatedAtIso: Schema.String
})

const ProjectRuntimeStateFileJsonSchema = Schema.parseJson(ProjectRuntimeStateFileSchema)

export const projectRuntimeStateRelativePath: ReadonlyArray<string> = [".orch", "state", "runtime.json"]

export const emptyProjectRuntimeState = (): ProjectRuntimeState => ({
  lastStartedAtIso: null,
  lastStartedAtEpochMs: null,
  lastStartAction: null,
  lastKnownStatus: "unknown",
  lastAgentSeenAtIso: null,
  lastAgentSeenAtEpochMs: null,
  lastInteractiveSeenAtIso: null,
  lastInteractiveSeenAtEpochMs: null,
  resourceProfile: "normal",
  lastStopReason: null,
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
  lastAgentSeenAtIso: fileState.lastAgentSeenAtIso ?? null,
  lastAgentSeenAtEpochMs: finiteEpochOrNull(fileState.lastAgentSeenAtEpochMs ?? null),
  lastInteractiveSeenAtIso: fileState.lastInteractiveSeenAtIso ?? null,
  lastInteractiveSeenAtEpochMs: finiteEpochOrNull(fileState.lastInteractiveSeenAtEpochMs ?? null),
  resourceProfile: fileState.resourceProfile ?? "normal",
  lastStopReason: fileState.lastStopReason ?? null,
  updatedAtIso: fileState.updatedAtIso
})

const toRuntimeStateFile = (
  state: ProjectRuntimeState,
  clock: RuntimeClock
): ProjectRuntimeStateFile => ({
  schemaVersion: 1,
  lastStartedAtIso: state.lastStartedAtIso,
  lastStartedAtEpochMs: state.lastStartedAtEpochMs,
  lastStartAction: state.lastStartAction,
  lastKnownStatus: state.lastKnownStatus,
  lastAgentSeenAtIso: state.lastAgentSeenAtIso,
  lastAgentSeenAtEpochMs: state.lastAgentSeenAtEpochMs,
  lastInteractiveSeenAtIso: state.lastInteractiveSeenAtIso,
  lastInteractiveSeenAtEpochMs: state.lastInteractiveSeenAtEpochMs,
  resourceProfile: state.resourceProfile,
  lastStopReason: state.lastStopReason,
  updatedAtIso: clock.iso
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
    const exists = yield* _(Effect.either(fs.exists(statePath)))
    const fileExists = Either.match(exists, {
      onLeft: () => false,
      onRight: (value) => value
    })
    if (!fileExists) {
      return emptyProjectRuntimeState()
    }

    const contents = yield* _(Effect.either(fs.readFileString(statePath)))
    const decoded = Either.match(contents, {
      onLeft: () => null,
      onRight: decodeProjectRuntimeStateFile
    })
    return decoded === null ? emptyProjectRuntimeState() : toRuntimeState(decoded)
  })

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
      lastAgentSeenAtIso: null,
      lastAgentSeenAtEpochMs: null,
      lastInteractiveSeenAtIso: clock.iso,
      lastInteractiveSeenAtEpochMs: clock.epochMs,
      resourceProfile: "normal",
      lastStopReason: null,
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
  projectDir: string,
  reason: ProjectRuntimeStopReason = "manual"
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
      lastAgentSeenAtIso: previous.lastAgentSeenAtIso,
      lastAgentSeenAtEpochMs: previous.lastAgentSeenAtEpochMs,
      lastInteractiveSeenAtIso: previous.lastInteractiveSeenAtIso,
      lastInteractiveSeenAtEpochMs: previous.lastInteractiveSeenAtEpochMs,
      resourceProfile: "normal",
      lastStopReason: reason,
      updatedAtIso: clock.iso
    }

    const written = yield* _(writeProjectRuntimeStateFile(projectDir, fileState))
    return toRuntimeState(written)
  })

export const recordProjectRuntimeActivity = (
  projectDir: string,
  activity: ProjectRuntimeActivityKind
): Effect.Effect<ProjectRuntimeState, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const previous = yield* _(readProjectRuntimeState(projectDir))
    const clock = yield* _(currentRuntimeClock())
    const next: ProjectRuntimeState = activity === "agent"
      ? {
        ...previous,
        lastAgentSeenAtIso: clock.iso,
        lastAgentSeenAtEpochMs: clock.epochMs,
        lastKnownStatus: "running",
        lastStopReason: null,
        updatedAtIso: clock.iso
      }
      : {
        ...previous,
        lastInteractiveSeenAtIso: clock.iso,
        lastInteractiveSeenAtEpochMs: clock.epochMs,
        lastKnownStatus: "running",
        lastStopReason: null,
        updatedAtIso: clock.iso
      }
    const written = yield* _(writeProjectRuntimeStateFile(projectDir, toRuntimeStateFile(next, clock)))
    return toRuntimeState(written)
  })

export const recordProjectRuntimeResourceProfile = (
  projectDir: string,
  resourceProfile: ProjectRuntimeResourceProfile
): Effect.Effect<ProjectRuntimeState, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const previous = yield* _(readProjectRuntimeState(projectDir))
    const clock = yield* _(currentRuntimeClock())
    const written = yield* _(
      writeProjectRuntimeStateFile(
        projectDir,
        toRuntimeStateFile({
          ...previous,
          resourceProfile,
          updatedAtIso: clock.iso
        }, clock)
      )
    )
    return toRuntimeState(written)
  })
