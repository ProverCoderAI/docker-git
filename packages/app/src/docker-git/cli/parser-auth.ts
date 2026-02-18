import { Either, Match } from "effect"

import type { RawOptions } from "@effect-template/lib/core/command-options"
import { type AuthCommand, type Command, type ParseError } from "@effect-template/lib/core/domain"

import { parseRawOptions } from "./parser-options.js"

type AuthOptions = {
  readonly envGlobalPath: string
  readonly codexAuthPath: string
  readonly label: string | null
  readonly token: string | null
  readonly scopes: string | null
  readonly authWeb: boolean
}

const missingArgument = (name: string): ParseError => ({
  _tag: "MissingRequiredOption",
  option: name
})

const invalidArgument = (name: string, reason: string): ParseError => ({
  _tag: "InvalidOption",
  option: name,
  reason
})

const normalizeLabel = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? ""
  return trimmed.length === 0 ? null : trimmed
}

const defaultEnvGlobalPath = ".docker-git/.orch/env/global.env"
const defaultCodexAuthPath = ".docker-git/.orch/auth/codex"

const resolveAuthOptions = (raw: RawOptions): AuthOptions => ({
  envGlobalPath: raw.envGlobalPath ?? defaultEnvGlobalPath,
  codexAuthPath: raw.codexAuthPath ?? defaultCodexAuthPath,
  label: normalizeLabel(raw.label),
  token: normalizeLabel(raw.token),
  scopes: normalizeLabel(raw.scopes),
  authWeb: raw.authWeb === true
})

const buildGithubCommand = (action: string, options: AuthOptions): Either.Either<AuthCommand, ParseError> =>
  Match.value(action).pipe(
    Match.when("login", () =>
      options.authWeb && options.token !== null
        ? Either.left(invalidArgument("--token", "cannot be combined with --web"))
        : Either.right<AuthCommand>({
          _tag: "AuthGithubLogin",
          label: options.label,
          token: options.authWeb ? null : options.token,
          scopes: options.scopes,
          envGlobalPath: options.envGlobalPath
        })),
    Match.when("status", () =>
      Either.right<AuthCommand>({
        _tag: "AuthGithubStatus",
        envGlobalPath: options.envGlobalPath
      })),
    Match.when("logout", () =>
      Either.right<AuthCommand>({
        _tag: "AuthGithubLogout",
        label: options.label,
        envGlobalPath: options.envGlobalPath
      })),
    Match.orElse(() => Either.left(invalidArgument("auth action", `unknown action '${action}'`)))
  )

const buildCodexCommand = (action: string, options: AuthOptions): Either.Either<AuthCommand, ParseError> =>
  Match.value(action).pipe(
    Match.when("login", () =>
      Either.right<AuthCommand>({
        _tag: "AuthCodexLogin",
        label: options.label,
        codexAuthPath: options.codexAuthPath
      })),
    Match.when("status", () =>
      Either.right<AuthCommand>({
        _tag: "AuthCodexStatus",
        label: options.label,
        codexAuthPath: options.codexAuthPath
      })),
    Match.when("logout", () =>
      Either.right<AuthCommand>({
        _tag: "AuthCodexLogout",
        label: options.label,
        codexAuthPath: options.codexAuthPath
      })),
    Match.orElse(() => Either.left(invalidArgument("auth action", `unknown action '${action}'`)))
  )

const buildAuthCommand = (
  provider: string,
  action: string,
  options: AuthOptions
): Either.Either<AuthCommand, ParseError> =>
  Match.value(provider).pipe(
    Match.when("github", () => buildGithubCommand(action, options)),
    Match.when("gh", () => buildGithubCommand(action, options)),
    Match.when("codex", () => buildCodexCommand(action, options)),
    Match.orElse(() => Either.left(invalidArgument("auth provider", `unknown provider '${provider}'`)))
  )

// CHANGE: parse docker-git auth subcommands
// WHY: keep auth flows in the same typed CLI parser
// QUOTE(ТЗ): "система авторизации"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall argv: parseAuth(argv) = cmd | error
// PURITY: CORE
// EFFECT: Effect<Command, ParseError, never>
// INVARIANT: no IO or side effects
// COMPLEXITY: O(n) where n = |argv|
export const parseAuth = (args: ReadonlyArray<string>): Either.Either<Command, ParseError> => {
  if (args.length < 2) {
    return Either.left(missingArgument(args.length === 0 ? "auth provider" : "auth action"))
  }

  const provider = args[0] ?? ""
  const action = args[1] ?? ""
  const rest = args.slice(2)

  return Either.flatMap(parseRawOptions(rest), (raw) => buildAuthCommand(provider, action, resolveAuthOptions(raw)))
}
