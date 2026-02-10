import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import type * as Effect from "effect/Effect"

import type { MenuAction } from "@effect-template/lib/core/domain"
import type { AppError } from "@effect-template/lib/usecases/errors"
import type { ProjectItem } from "@effect-template/lib/usecases/projects"

// CHANGE: isolate TUI types/constants into a shared module
// WHY: keep menu rendering and input handling small and focused
// QUOTE(ТЗ): "TUI? Красивый, удобный"
// REF: user-request-2026-02-01-tui
// SOURCE: n/a
// FORMAT THEOREM: forall s: state(s) -> wellTyped(s)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: createSteps is ordered and total over CreateStep
// COMPLEXITY: O(1)

export type MenuState = {
  readonly cwd: string
  readonly activeDir: string | null
}

export type MenuEnv = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor

export type MenuRunner = {
  readonly runEffect: (effect: Effect.Effect<void, AppError, MenuEnv>) => void
}

export type MenuViewContext = {
  readonly setView: (view: ViewState) => void
  readonly setMessage: (message: string | null) => void
  readonly setActiveDir: (dir: string | null) => void
}

export type MenuKeyInput = {
  readonly upArrow?: boolean
  readonly downArrow?: boolean
  readonly return?: boolean
  readonly escape?: boolean
}

export type CreateInputs = {
  readonly repoUrl: string
  readonly repoRef: string
  readonly outDir: string
  readonly secretsRoot: string
  readonly runUp: boolean
  readonly enableMcpPlaywright: boolean
  readonly force: boolean
}

export type CreateStep =
  | "repoUrl"
  | "repoRef"
  | "outDir"
  | "runUp"
  | "mcpPlaywright"
  | "force"

export const createSteps: ReadonlyArray<CreateStep> = [
  "repoUrl",
  "repoRef",
  "outDir",
  "runUp",
  "mcpPlaywright",
  "force"
]

export type ViewState =
  | { readonly _tag: "Menu" }
  | { readonly _tag: "Create"; readonly step: number; readonly buffer: string; readonly values: Partial<CreateInputs> }
  | {
    readonly _tag: "SelectProject"
    readonly purpose: "Connect" | "Down" | "Info" | "Delete"
    readonly items: ReadonlyArray<ProjectItem>
    readonly selected: number
    readonly confirmDelete: boolean
  }

export const menuItems: ReadonlyArray<{ readonly id: MenuAction; readonly label: string }> = [
  { id: { _tag: "Create" }, label: "Create project" },
  { id: { _tag: "Select" }, label: "Select project" },
  { id: { _tag: "Info" }, label: "Show connection info" },
  { id: { _tag: "Status" }, label: "docker compose ps" },
  { id: { _tag: "Logs" }, label: "docker compose logs --tail=200" },
  { id: { _tag: "Down" }, label: "docker compose down" },
  { id: { _tag: "DownAll" }, label: "docker compose down (ALL projects)" },
  { id: { _tag: "Delete" }, label: "Delete project (remove folder)" },
  { id: { _tag: "Quit" }, label: "Quit" }
]
