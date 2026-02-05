import { type ParseError } from "./domain.js"

// CHANGE: define reusable command option shape for create/clone/auth builders
// WHY: decouple pure command construction from CLI parsing locations
// QUOTE(ТЗ): "В lib ты оставляешь бизнес логику, а все CLI морду хранишь в app"
// REF: user-request-2026-02-02-cli-split
// SOURCE: n/a
// FORMAT THEOREM: forall o: RawOptions -> deterministic(o)
// PURITY: CORE
// EFFECT: Effect<never>
// INVARIANT: all fields are optional and represent raw user intent
// COMPLEXITY: O(1)
export interface RawOptions {
  readonly repoUrl?: string
  readonly repoRef?: string
  readonly targetDir?: string
  readonly sshPort?: string
  readonly sshUser?: string
  readonly containerName?: string
  readonly serviceName?: string
  readonly volumeName?: string
  readonly secretsRoot?: string
  readonly authorizedKeysPath?: string
  readonly envGlobalPath?: string
  readonly envProjectPath?: string
  readonly codexAuthPath?: string
  readonly codexHome?: string
  readonly label?: string
  readonly token?: string
  readonly authWeb?: boolean
  readonly outDir?: string
  readonly projectDir?: string
  readonly lines?: string
  readonly includeDefault?: boolean
  readonly up?: boolean
  readonly force?: boolean
}

// CHANGE: helper type alias for builder signatures that produce parse errors
// WHY: keep error typing consistent without CLI parsing
// QUOTE(ТЗ): "Ошибки типизированы"
// REF: user-request-2026-02-02-cli-split
// SOURCE: n/a
// FORMAT THEOREM: forall e: ParseError -> typed(e)
// PURITY: CORE
// EFFECT: Effect<never>
// INVARIANT: ParseError tags are preserved
// COMPLEXITY: O(1)
export type CommandBuildError = ParseError
