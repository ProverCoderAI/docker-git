import { Either } from "effect"

import { type OpenCommand, type ParseError } from "@lib/core/domain"

import { parseRawOptions } from "./parser-options.js"

type OpenParts = {
  readonly projectRef?: string | undefined
  readonly projectDir?: string | undefined
}

const splitOpenArgs = (
  args: ReadonlyArray<string>
): { readonly positionalRef: string | undefined; readonly rest: ReadonlyArray<string> } => {
  const first = args[0]
  const positionalRef = first !== undefined && !first.startsWith("-") ? first : undefined
  return {
    positionalRef,
    rest: positionalRef === undefined ? args : args.slice(1)
  }
}

const buildOpenCommand = (parts: OpenParts): OpenCommand => ({
  _tag: "Open",
  ...(parts.projectRef === undefined ? {} : { projectRef: parts.projectRef }),
  ...(parts.projectDir === undefined ? {} : { projectDir: parts.projectDir })
})

const normalizeSelector = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : undefined
}

// CHANGE: parse open as a distinct selector-based command
// WHY: open must resolve existing projects by raw selector without tmux semantics
// QUOTE(ТЗ): "open should parse to a distinct _tag: \"Open\" command"
// REF: user-request-2026-04-02-open-command-parser
// SOURCE: n/a
// FORMAT THEOREM: forall argv: parseOpen(argv) = cmd -> cmd._tag = "Open"
// PURITY: CORE
// EFFECT: Effect<OpenCommand, ParseError, never>
// INVARIANT: preserves raw selector and optional explicit projectDir override
// COMPLEXITY: O(n) where n = |argv|
export const parseOpen = (args: ReadonlyArray<string>): Either.Either<OpenCommand, ParseError> => {
  const { positionalRef, rest } = splitOpenArgs(args)
  return Either.flatMap(parseRawOptions(rest), (raw) =>
    Either.right(
      buildOpenCommand({
        ...(normalizeSelector(raw.projectDir) === undefined
          ? {}
          : { projectDir: normalizeSelector(raw.projectDir) }),
        ...(normalizeSelector(raw.containerName ?? raw.repoUrl ?? positionalRef) === undefined
          ? {}
          : { projectRef: normalizeSelector(raw.containerName ?? raw.repoUrl ?? positionalRef) })
      })
    ))
}
