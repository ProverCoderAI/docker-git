import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect, Either, Match, pipe } from "effect"

import {
  type CreateCommand,
  deriveRepoPathParts,
  formatParseError,
  type MenuAction,
  parseMenuSelection,
  type ProjectConfig,
  usageText
} from "@effect-template/lib/core/domain"
import { parseArgs } from "@effect-template/lib/core/parser"
import { readProjectConfig } from "@effect-template/lib/shell/config"
import {
  runDockerComposeDown,
  runDockerComposeLogs,
  runDockerComposePs,
  runDockerComposeUp
} from "@effect-template/lib/shell/docker"
import type { InputCancelledError } from "@effect-template/lib/shell/errors"
import { promptLine } from "@effect-template/lib/shell/input"
import { createProject } from "@effect-template/lib/usecases/actions"
import { type AppError, renderError } from "@effect-template/lib/usecases/errors"
import {
  defaultProjectsRoot,
  findSshPrivateKey,
  formatConnectionInfo,
  isRepoUrlInput,
  resolveAuthorizedKeysPath
} from "@effect-template/lib/usecases/menu-helpers"

type MenuState = {
  readonly cwd: string
  readonly activeDir: string | null
}

type MenuOutcome =
  | { readonly _tag: "Continue"; readonly state: MenuState }
  | { readonly _tag: "Quit" }

const continueWith = (state: MenuState): MenuOutcome => ({ _tag: "Continue", state })

const quitOutcome: MenuOutcome = { _tag: "Quit" }

// CHANGE: handle create commands without nested generator functions
// WHY: keep menu flow within lint complexity limits while preserving behavior
// QUOTE(ТЗ): "Хочу что бы открылось менюшка"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall c: create(c) -> activeDir(resolved(c))
// PURITY: SHELL
// EFFECT: Effect<MenuOutcome, AppError, FileSystem | Path | CommandExecutor>
// INVARIANT: activeDir is set to resolved output directory
// COMPLEXITY: O(1)
const applyCreateCommand = (
  state: MenuState,
  create: CreateCommand
): Effect.Effect<
  MenuOutcome,
  AppError,
  FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> =>
  Effect.gen(function*(_) {
    const path = yield* _(Path.Path)
    const resolvedOutDir = path.resolve(create.outDir)
    yield* _(createProject(create))
    return continueWith({ ...state, activeDir: resolvedOutDir })
  })

const renderMenuText = (state: MenuState): string => {
  const activeLine = state.activeDir === null
    ? "Active project: (none)"
    : `Active project: ${state.activeDir}`

  return `docker-git menu
${activeLine}

1) Create project
2) Show connection info
3) docker compose up -d --build
4) docker compose ps
5) docker compose logs --tail=200
6) docker compose down
0) Quit

Select option: `
}

const normalizeYesNo = (input: string): string => input.trim().toLowerCase()

const parseYesDefault = (input: string, fallback: boolean): boolean => {
  const normalized = normalizeYesNo(input)
  if (normalized === "y" || normalized === "yes") {
    return true
  }
  if (normalized === "n" || normalized === "no") {
    return false
  }
  return fallback
}

const handleMissingConfig = (state: MenuState, error: AppError) =>
  pipe(
    Effect.logError(renderError(error)),
    Effect.as<MenuOutcome>(continueWith(state))
  )

const withProjectConfig = <R>(
  state: MenuState,
  f: (config: ProjectConfig) => Effect.Effect<void, AppError, R>
) =>
  pipe(
    readProjectConfig(state.activeDir ?? state.cwd),
    Effect.flatMap((config) => pipe(f(config), Effect.as<MenuOutcome>(continueWith(state)))),
    Effect.catchAll((error) =>
      error._tag === "ConfigNotFoundError" || error._tag === "ConfigDecodeError"
        ? handleMissingConfig(state, error)
        : Effect.fail(error)
    )
  )

type CreateInputs = {
  readonly repoUrl: string
  readonly repoRef: string
  readonly outDir: string
  readonly secretsRoot: string
  readonly runUp: boolean
  readonly force: boolean
}

const buildCreateArgs = (input: CreateInputs): ReadonlyArray<string> => {
  const args: Array<string> = ["create", "--repo-url", input.repoUrl, "--secrets-root", input.secretsRoot]
  if (input.repoRef.length > 0) {
    args.push("--repo-ref", input.repoRef)
  }
  args.push("--out-dir", input.outDir)
  if (!input.runUp) {
    args.push("--no-up")
  }
  if (input.force) {
    args.push("--force")
  }
  return args
}

const readCreateInputs = (
  state: MenuState,
  repoUrlOverride?: string
): Effect.Effect<CreateInputs | null, AppError, Path.Path> =>
  Effect.gen(function*(_) {
    const repoUrlInput = repoUrlOverride ?? (yield* _(promptLine("Repo URL: ")))
    const repoUrl = repoUrlInput.trim()
    if (repoUrl.length === 0) {
      yield* _(Effect.logError("Repo URL is required."))
      return null
    }

    const path = yield* _(Path.Path)
    const projectsRoot = defaultProjectsRoot(state.cwd)
    const secretsRoot = path.join(projectsRoot, "secrets")
    const repoPath = deriveRepoPathParts(repoUrl).pathParts
    const defaultOutDir = path.join(projectsRoot, ...repoPath)
    const repoRefInput = yield* _(promptLine("Repo ref [main]: "))
    const repoRef = repoRefInput.trim()

    const outDirInput = yield* _(
      promptLine(`Output dir for docker files [${defaultOutDir}]: `)
    )
    const outDir = outDirInput.trim().length > 0 ? outDirInput.trim() : defaultOutDir

    const runUpInput = yield* _(promptLine("Run docker compose up now? [Y/n]: "))
    const runUp = parseYesDefault(runUpInput, true)

    const forceInput = yield* _(promptLine("Overwrite existing files? [y/N]: "))
    const force = parseYesDefault(forceInput, false)

    return { repoUrl, repoRef, outDir, secretsRoot, runUp, force }
  })

const handleCreate = (state: MenuState, repoUrlOverride?: string) =>
  Effect.gen(function*(_) {
    const input = yield* _(readCreateInputs(state, repoUrlOverride))
    if (input === null) {
      return continueWith(state)
    }

    const parsed = parseArgs(buildCreateArgs(input))
    return yield* _(
      Either.match(parsed, {
        onLeft: (error) => pipe(Effect.logError(formatParseError(error)), Effect.as<MenuOutcome>(continueWith(state))),
        onRight: (command) =>
          Match.value(command).pipe(
            Match.when({ _tag: "Create" }, (create) => applyCreateCommand(state, create)),
            Match.when(
              { _tag: "Help" },
              () => pipe(Effect.log(usageText), Effect.as<MenuOutcome>(continueWith(state)))
            ),
            Match.when({ _tag: "Status" }, () => Effect.succeed<MenuOutcome>(continueWith(state))),
            Match.when({ _tag: "Menu" }, () => Effect.succeed<MenuOutcome>(continueWith(state))),
            Match.exhaustive
          )
      })
    )
  })

const handleMenuAction = (
  state: MenuState,
  action: MenuAction
) =>
  Match.value(action).pipe(
    Match.when({ _tag: "Quit" }, () => Effect.succeed<MenuOutcome>(quitOutcome)),
    Match.when({ _tag: "Create" }, () => handleCreate(state)),
    Match.when({ _tag: "Info" }, () =>
      withProjectConfig(state, (config) =>
        Effect.gen(function*(_) {
          const fs = yield* _(FileSystem.FileSystem)
          const path = yield* _(Path.Path)
          const baseDir = state.activeDir ?? state.cwd
          const resolvedAuthorizedKeys = resolveAuthorizedKeysPath(
            path,
            baseDir,
            config.template.authorizedKeysPath
          )
          const authExists = yield* _(fs.exists(resolvedAuthorizedKeys))
          const sshKey = yield* _(findSshPrivateKey(fs, path, state.cwd))
          const sshBase = `ssh -p ${config.template.sshPort} ${config.template.sshUser}@localhost`
          const sshCommand = sshKey === null
            ? sshBase
            : `ssh -i ${sshKey} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p ${config.template.sshPort} ${config.template.sshUser}@localhost`

          yield* _(
            Effect.log(
              formatConnectionInfo(baseDir, config, resolvedAuthorizedKeys, authExists, sshCommand)
            )
          )

          if (!authExists) {
            yield* _(
              Effect.logError(
                `Create ${resolvedAuthorizedKeys} with your public key to enable SSH.`
              )
            )
          }
        }))),
    Match.when({ _tag: "Up" }, () => withProjectConfig(state, () => runDockerComposeUp(state.activeDir ?? state.cwd))),
    Match.when({ _tag: "Status" }, () =>
      withProjectConfig(state, () => runDockerComposePs(state.activeDir ?? state.cwd))),
    Match.when({ _tag: "Logs" }, () =>
      withProjectConfig(state, () =>
        runDockerComposeLogs(state.activeDir ?? state.cwd))),
    Match.when({ _tag: "Down" }, () =>
      withProjectConfig(state, () =>
        runDockerComposeDown(state.activeDir ?? state.cwd))),
    Match.exhaustive
  )

const menuLoop = (
  state: MenuState
): Effect.Effect<
  void,
  AppError | InputCancelledError,
  FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> =>
  pipe(
    promptLine(renderMenuText(state)),
    Effect.flatMap((input) => {
      const trimmed = input.trim()
      if (isRepoUrlInput(trimmed)) {
        return handleCreate(state, trimmed)
      }
      const selection = parseMenuSelection(input)
      return Either.match(selection, {
        onLeft: (error) => pipe(Effect.logError(formatParseError(error)), Effect.as<MenuOutcome>(continueWith(state))),
        onRight: (action) => handleMenuAction(state, action)
      })
    }),
    Effect.flatMap((outcome) =>
      Match.value(outcome).pipe(
        Match.when({ _tag: "Quit" }, () => Effect.void),
        Match.when({ _tag: "Continue" }, ({ state: nextState }) => menuLoop(nextState)),
        Match.exhaustive
      )
    )
  )

// CHANGE: provide an interactive menu for docker-git management
// WHY: enable a Codex-like interface without extra flags
// QUOTE(ТЗ): "Я хочу что бы открылось менюшка"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall s: menu(s) terminates when Quit selected
// PURITY: SHELL
// EFFECT: Effect<void, AppError, FileSystem | Path | CommandExecutor>
// INVARIANT: menu loops until explicit quit or ctrl+c
// COMPLEXITY: O(n) per menu action
export const runMenu = pipe(
  Effect.sync(() => ({ cwd: process.cwd(), activeDir: null })),
  Effect.flatMap((state) => menuLoop(state)),
  Effect.catchTag("InputCancelledError", () => Effect.void)
)
