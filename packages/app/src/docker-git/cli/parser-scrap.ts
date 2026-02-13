import { Either, Match } from "effect"

import type { Command, ParseError } from "@effect-template/lib/core/domain"

import { parseProjectDirWithOptions } from "./parser-shared.js"

const missingRequired = (option: string): ParseError => ({
  _tag: "MissingRequiredOption",
  option
})

const invalidScrapAction = (value: string): ParseError => ({
  _tag: "InvalidOption",
  option: "scrap",
  reason: `unknown action: ${value}`
})

const defaultArchivePath = ".orch/scrap/workspace.tar.gz"

const makeScrapExportCommand = (projectDir: string, archivePath: string): Command => ({
  _tag: "ScrapExport",
  projectDir,
  archivePath
})

const makeScrapImportCommand = (
  projectDir: string,
  archivePath: string,
  wipe: boolean
): Command => ({
  _tag: "ScrapImport",
  projectDir,
  archivePath,
  wipe
})

// CHANGE: parse scrap (workspace cache) export/import commands
// WHY: allow copying docker-git workspace caches (deps, .env, build artifacts) across machines
// QUOTE(ТЗ): "мог копировать скрап (кеш) от докер контейнеров"
// REF: issue-27
// SOURCE: n/a
// FORMAT THEOREM: forall argv: parseScrap(argv) = cmd -> deterministic(cmd)
// PURITY: CORE
// EFFECT: Effect<Command, ParseError, never>
// INVARIANT: export/import always resolves a projectDir
// COMPLEXITY: O(n) where n = |argv|
export const parseScrap = (args: ReadonlyArray<string>): Either.Either<Command, ParseError> => {
  const action = args[0]?.trim()
  if (!action || action.length === 0) {
    return Either.left(missingRequired("scrap <action>"))
  }

  const rest = args.slice(1)

  return Match.value(action).pipe(
    Match.when("export", () =>
      Either.map(parseProjectDirWithOptions(rest), ({ projectDir, raw }) =>
        makeScrapExportCommand(
          projectDir,
          raw.archivePath?.trim() && raw.archivePath.trim().length > 0
            ? raw.archivePath.trim()
            : defaultArchivePath
        ))),
    Match.when("import", () =>
      Either.flatMap(parseProjectDirWithOptions(rest), ({ projectDir, raw }) => {
        const archivePath = raw.archivePath?.trim()
        if (!archivePath || archivePath.length === 0) {
          return Either.left(missingRequired("--archive"))
        }
        return Either.right(makeScrapImportCommand(projectDir, archivePath, raw.wipe ?? true))
      })),
    Match.orElse(() => Either.left(invalidScrapAction(action)))
  )
}
