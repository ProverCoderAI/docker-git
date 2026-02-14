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

const defaultCacheArchivePath = ".orch/scrap/workspace.tar.gz"
const defaultSessionArchiveDir = ".orch/scrap/session"

const invalidScrapMode = (value: string): ParseError => ({
  _tag: "InvalidOption",
  option: "--mode",
  reason: `unknown value: ${value} (expected cache|session)`
})

const parseScrapMode = (raw: string | undefined): Either.Either<"cache" | "session", ParseError> => {
  const value = raw?.trim()
  if (!value || value.length === 0) {
    return Either.right("cache")
  }
  if (value === "cache" || value === "session") {
    return Either.right(value)
  }
  return Either.left(invalidScrapMode(value))
}

const makeScrapExportCommand = (projectDir: string, archivePath: string, mode: "cache" | "session"): Command => ({
  _tag: "ScrapExport",
  projectDir,
  archivePath,
  mode
})

const makeScrapImportCommand = (
  projectDir: string,
  archivePath: string,
  wipe: boolean,
  mode: "cache" | "session"
): Command => ({
  _tag: "ScrapImport",
  projectDir,
  archivePath,
  wipe,
  mode
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
    Match.when(
      "export",
      () =>
        Either.flatMap(
          parseProjectDirWithOptions(rest),
          ({ projectDir, raw }) =>
            Either.map(parseScrapMode(raw.scrapMode), (mode) => {
              const archivePathRaw = raw.archivePath?.trim()
              if (archivePathRaw && archivePathRaw.length > 0) {
                return makeScrapExportCommand(projectDir, archivePathRaw, mode)
              }
              const defaultPath = mode === "session" ? defaultSessionArchiveDir : defaultCacheArchivePath
              return makeScrapExportCommand(projectDir, defaultPath, mode)
            })
        )
    ),
    Match.when("import", () =>
      Either.flatMap(parseProjectDirWithOptions(rest), ({ projectDir, raw }) => {
        const archivePath = raw.archivePath?.trim()
        if (!archivePath || archivePath.length === 0) {
          return Either.left(missingRequired("--archive"))
        }
        return Either.map(parseScrapMode(raw.scrapMode), (mode) =>
          makeScrapImportCommand(projectDir, archivePath, raw.wipe ?? true, mode))
      })),
    Match.orElse(() => Either.left(invalidScrapAction(action)))
  )
}
