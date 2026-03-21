// CHANGE: session backup commands for PR-based session history
// WHY: enables returning to old AI sessions via a private backup repository
// QUOTE(ТЗ): "иметь возможность возвращаться ко всем старым сессиям с агентами"
// REF: issue-143
// PURITY: CORE

export interface SessionGistBackupCommand {
  readonly _tag: "SessionGistBackup"
  readonly projectDir: string
  readonly prNumber: number | null
  readonly repo: string | null
  readonly postComment: boolean
}

export interface SessionGistListCommand {
  readonly _tag: "SessionGistList"
  readonly limit: number
  readonly repo: string | null
}

export interface SessionGistViewCommand {
  readonly _tag: "SessionGistView"
  readonly snapshotRef: string
}

export interface SessionGistDownloadCommand {
  readonly _tag: "SessionGistDownload"
  readonly snapshotRef: string
  readonly outputDir: string
}

export type SessionGistCommand =
  | SessionGistBackupCommand
  | SessionGistListCommand
  | SessionGistViewCommand
  | SessionGistDownloadCommand
