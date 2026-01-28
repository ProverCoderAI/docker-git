import { Console, Effect, Match, pipe } from "effect"

import { listProjects, readCloneRequest, runDockerGitClone } from "@effect-template/lib"

import { formatGreeting } from "../core/greeting.js"
import { readGreetingVariant } from "../shell/cli.js"

/**
 * Compose the CLI program as a single effect.
 *
 * @returns Effect that either runs docker-git clone or logs a greeting.
 *
 * @pure false - uses Console output and spawns commands when cloning
 * @effect Console, CommandExecutor, Path
 * @invariant forall args in Argv: clone(args) -> docker_git_invoked(args)
 * @precondition true
 * @postcondition clone(args) -> docker_git_invoked(args); otherwise greeting logged
 * @complexity O(build + clone)
 * @throws Never - all errors are typed in the Effect error channel
 */
// CHANGE: extract the composed program into a reusable Effect
// WHY: keep the entrypoint as a thin platform runtime shell and make testing deterministic
// QUOTE(TZ): "\u0414\u0430 \u0434\u0430\u0432\u0430\u0439 \u0442\u0430\u043a \u044d\u0442\u043e \u0431\u043e\u043b\u0435\u0435 \u043f\u0440\u0430\u0432\u0438\u043b\u044c\u043d\u0430\u044f \u0440\u0435\u0430\u043b\u0438\u0437\u0430\u0446\u0438\u044f"
// REF: user-2025-12-19-platform-node
// SOURCE: https://effect.website/docs/platform/runtime/ "runMain helps you execute a main effect with built-in error handling, logging, and signal management."
// FORMAT THEOREM: forall args in Argv: decode(args) = v -> log(formatGreeting(v))
// PURITY: SHELL
// EFFECT: Effect<string, S.ParseError, Console>
// INVARIANT: exactly one log entry per successful parse
// COMPLEXITY: O(1)/O(1)
const runGreeting = pipe(
  readGreetingVariant,
  Effect.map((variant) => formatGreeting(variant)),
  Effect.tap(Console.log)
)

// CHANGE: route between clone runner and greeting based on CLI context
// WHY: allow pnpm run clone <url> without losing the existing greeting CLI
// QUOTE(ТЗ): "pnpm run clone <url>"
// REF: user-request-2026-01-27
// SOURCE: n/a
// FORMAT THEOREM: forall argv: clone(argv) -> docker_git_invoked(argv)
// PURITY: SHELL
// EFFECT: Effect<void, Error, Console | CommandExecutor | Path>
// INVARIANT: greeting path remains unchanged when clone is not requested
// COMPLEXITY: O(build + clone)
const runDockerGit = pipe(
  readCloneRequest,
  Effect.flatMap((request) =>
    Match.value(request).pipe(
      Match.when({ _tag: "Clone" }, ({ args }) => runDockerGitClone(args)),
      Match.when({ _tag: "None" }, () => runGreeting),
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
