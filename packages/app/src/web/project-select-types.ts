export type SelectProjectRuntime = {
  readonly running: boolean
  readonly sshSessions: number
  readonly startedAtIso: string | null
  readonly startedAtEpochMs: number | null
}
