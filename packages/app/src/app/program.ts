import { listProjects, readCloneRequest, runDockerGitClone } from "@effect-template/lib"
import { Console, Effect, Match, pipe } from "effect"

/**
 * Compose the CLI program as a single effect.
 *
 * @returns Effect that either runs docker-git clone or prints usage.
 *
 * @pure false - uses Console output and spawns commands when cloning
 * @effect Console, CommandExecutor, Path
 * @invariant forall args in Argv: clone(args) -> docker_git_invoked(args)
 * @precondition true
 * @postcondition clone(args) -> docker_git_invoked(args); otherwise usage printed
 * @complexity O(build + clone)
 * @throws Never - all errors are typed in the Effect error channel
 */
// CHANGE: replace greeting demo with deterministic usage text
// WHY: greeting was scaffolding noise and should not ship in docker-git tooling
// QUOTE(ТЗ): "Можешь удалить использование greting ...? Это старый мусор который остался"
// REF: user-request-2026-02-06-remove-greeting
// SOURCE: n/a
// FORMAT THEOREM: usageText is constant -> deterministic(help)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: usageText does not depend on argv/env
// COMPLEXITY: O(1)
const usageText = [
  "Usage:",
  "  pnpm docker-git",
  "  pnpm clone <repo-url> [ref]",
  "  pnpm list",
  "",
  "Notes:",
  "  - docker-git is the interactive TUI.",
  "  - clone builds + runs docker-git clone for you."
].join("\n")

// PURITY: SHELL
// EFFECT: Effect<void, never, Console>
const runHelp = Console.log(usageText)

// CHANGE: route between clone runner and help based on CLI context
// WHY: allow pnpm run clone <url> while keeping a single entrypoint
// QUOTE(ТЗ): "pnpm run clone <url>"
// REF: user-request-2026-01-27
// SOURCE: n/a
// FORMAT THEOREM: forall argv: clone(argv) -> docker_git_invoked(argv)
// PURITY: SHELL
// EFFECT: Effect<void, Error, Console | CommandExecutor | Path>
// INVARIANT: help is printed when clone is not requested
// COMPLEXITY: O(build + clone)
const runDockerGit = pipe(
  readCloneRequest,
  Effect.flatMap((request) =>
    Match.value(request).pipe(
      Match.when({ _tag: "Clone" }, ({ args }) => runDockerGitClone(args)),
      Match.when({ _tag: "None" }, () => runHelp),
      Match.exhaustive
    )
  )
)

const readListFlag = Effect.sync(() => {
  const command = process.argv.slice(2)[0] ?? ""
  return command === "list" || command === "ls"
})

export const program = Effect.gen(function*(_) {
  const isList = yield* _(readListFlag)
  if (isList) {
    yield* _(listProjects)
    return
  }
  yield* _(runDockerGit)
})
