import { Effect, Match, pipe } from "effect"

import type { Command } from "@effect-template/lib/core/domain"
import { readCommand } from "@effect-template/lib/shell/cli"
import { createProject } from "@effect-template/lib/usecases/actions"
import { renderError } from "@effect-template/lib/usecases/errors"
import { listProjectStatus } from "@effect-template/lib/usecases/projects"

import { runMenu } from "./menu.js"

// CHANGE: compose CLI program with typed errors and shell effects
// WHY: keep a thin entry layer over pure parsing and template generation
// QUOTE(ТЗ): "CLI команду... создавать докер образы"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall cmd: handle(cmd) terminates with typed outcome
// PURITY: SHELL
// EFFECT: Effect<void, AppError, FileSystem | Path | CommandExecutor>
// INVARIANT: help is printed without side effects beyond logs
// COMPLEXITY: O(n) where n = |files|
export const program = pipe(
  readCommand,
  Effect.flatMap((command: Command) =>
    Match.value(command).pipe(
      Match.when({ _tag: "Help" }, ({ message }) => Effect.log(message)),
      Match.when({ _tag: "Create" }, (create) => createProject(create)),
      Match.when({ _tag: "Status" }, () => listProjectStatus),
      Match.when({ _tag: "Menu" }, () => runMenu),
      Match.exhaustive
    )
  ),
  Effect.catchTag("FileExistsError", (error) =>
    pipe(
      Effect.logWarning(renderError(error)),
      Effect.asVoid
    )),
  Effect.catchAll((error) =>
    pipe(
      Effect.logError(renderError(error)),
      Effect.flatMap(() => Effect.fail(error))
    )
  ),
  Effect.asVoid
)
