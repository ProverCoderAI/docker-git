import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect, pipe } from "effect"

import { runDockerPsNames } from "../shell/docker.js"
import type { CommandFailedError } from "../shell/errors.js"
import {
  loadProjectItem,
  loadProjectSummary,
  type ProjectItem,
  type ProjectSummary,
  renderProjectSummary,
  skipWithWarning,
  withProjectIndexAndSsh
} from "./projects-core.js"

// CHANGE: list docker-git projects with SSH connection info
// WHY: provide a deterministic inventory of created environments
// QUOTE(ТЗ): "мне нужны мои... доступы к ним по SSH"
// REF: user-request-2026-01-27-list
// SOURCE: n/a
// FORMAT THEOREM: forall root: list(root) -> summaries(root)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem | Path>
// INVARIANT: output is deterministic for a stable filesystem
// COMPLEXITY: O(n) where n = |projects|
export const listProjects: Effect.Effect<
  void,
  PlatformError,
  FileSystem.FileSystem | Path.Path
> = pipe(
  withProjectIndexAndSsh((index, sshKey) =>
    Effect.gen(function*(_) {
      const available: Array<ProjectSummary> = []

      for (const configPath of index.configPaths) {
        const summary = yield* _(
          loadProjectSummary(configPath, sshKey).pipe(
            Effect.matchEffect({
              onFailure: skipWithWarning<ProjectSummary>(configPath),
              onSuccess: (value) => Effect.succeed(value)
            })
          )
        )
        if (summary !== null) {
          available.push(summary)
        }
      }
      if (available.length === 0) {
        yield* _(Effect.log(`No readable docker-git projects found in ${index.projectsRoot}`))
        return
      }

      yield* _(Effect.log(`Found ${available.length} docker-git project(s) in ${index.projectsRoot}`))
      for (const summary of available) {
        yield* _(Effect.log(renderProjectSummary(summary)))
      }
    })
  ),
  Effect.asVoid
)

// CHANGE: collect docker-git connection info lines without logging
// WHY: allow TUI to render connection info inline
// QUOTE(ТЗ): "А кнопка \"Show connection info\" ничего не отображает"
// REF: user-request-2026-02-01-tui-info
// SOURCE: n/a
// FORMAT THEOREM: forall p in projects: summary(p) -> line(p)
// PURITY: SHELL
// EFFECT: Effect<ReadonlyArray<string>, PlatformError, FileSystem | Path>
// INVARIANT: output order matches configPaths order
// COMPLEXITY: O(n) where n = |projects|
const emptySummaries = (): ReadonlyArray<string> => []
const emptyItems = (): ReadonlyArray<ProjectItem> => []

const collectProjectValues = <A, B, E>(
  configPaths: ReadonlyArray<string>,
  sshKey: string | null,
  load: (configPath: string, sshKey: string | null) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
  toValue: (value: A) => B
): Effect.Effect<ReadonlyArray<B>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const available: Array<B> = []

    for (const configPath of configPaths) {
      const value = yield* _(
        load(configPath, sshKey).pipe(
          Effect.matchEffect({
            onFailure: () => Effect.succeed(null),
            onSuccess: (item) => Effect.succeed(toValue(item))
          })
        )
      )
      if (value !== null) {
        available.push(value)
      }
    }

    return available
  })

const listProjectValues = <A, B, E>(
  load: (configPath: string, sshKey: string | null) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
  toValue: (value: A) => B,
  empty: () => ReadonlyArray<B>
): Effect.Effect<ReadonlyArray<B>, PlatformError, FileSystem.FileSystem | Path.Path> =>
  pipe(
    withProjectIndexAndSsh((index, sshKey) => collectProjectValues(index.configPaths, sshKey, load, toValue)),
    Effect.map((values) => values ?? empty())
  )

export const listProjectSummaries: Effect.Effect<
  ReadonlyArray<string>,
  PlatformError,
  FileSystem.FileSystem | Path.Path
> = listProjectValues(loadProjectSummary, renderProjectSummary, emptySummaries)

// CHANGE: load docker-git projects for TUI selection
// WHY: provide structured project data without noisy logs
// QUOTE(ТЗ): "А ты можешь сделать удобный выбор проектов?"
// REF: user-request-2026-02-02-select-project
// SOURCE: n/a
// FORMAT THEOREM: forall p in projects: item(p) -> selectable(p)
// PURITY: SHELL
// EFFECT: Effect<ReadonlyArray<ProjectItem>, PlatformError, FileSystem | Path>
// INVARIANT: output order matches configPaths order
// COMPLEXITY: O(n) where n = |projects|
export const listProjectItems: Effect.Effect<
  ReadonlyArray<ProjectItem>,
  PlatformError,
  FileSystem.FileSystem | Path.Path
> = listProjectValues(loadProjectItem, (value) => value, emptyItems)

// CHANGE: list only running docker-git projects (for "Stop container" UI)
// WHY: stopping already-stopped projects is confusing and noisy
// QUOTE(ТЗ): "Смысл мне пытаться остановить тот контейнер который уже остановлен?"
// REF: user-request-2026-02-07-stop-only-running
// SOURCE: n/a
// FORMAT THEOREM: forall p in result: running(container(p))
// PURITY: SHELL
// EFFECT: Effect<ReadonlyArray<ProjectItem>, PlatformError | CommandFailedError, FileSystem | Path | CommandExecutor>
// INVARIANT: result order follows listProjectItems order
// COMPLEXITY: O(n + command)
export const listRunningProjectItems: Effect.Effect<
  ReadonlyArray<ProjectItem>,
  PlatformError | CommandFailedError,
  FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> = pipe(
  Effect.all([listProjectItems, runDockerPsNames(process.cwd())]),
  Effect.map(([items, runningNames]) => items.filter((item) => runningNames.includes(item.containerName)))
)
