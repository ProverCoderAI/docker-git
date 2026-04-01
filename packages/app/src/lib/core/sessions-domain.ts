/* jscpd:ignore-start */
import type { SessionGistCommand } from "./session-gist-domain.js"

export interface SessionsListCommand {
  readonly _tag: "SessionsList"
  readonly projectDir: string
  readonly includeDefault: boolean
}

export interface SessionsKillCommand {
  readonly _tag: "SessionsKill"
  readonly projectDir: string
  readonly pid: number
}

export interface SessionsLogsCommand {
  readonly _tag: "SessionsLogs"
  readonly projectDir: string
  readonly pid: number
  readonly lines: number
}

export type SessionsCommand =
  | SessionsListCommand
  | SessionsKillCommand
  | SessionsLogsCommand
  | SessionGistCommand
/* jscpd:ignore-end */
