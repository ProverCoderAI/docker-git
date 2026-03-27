export interface StatePathCommand {
  readonly _tag: "StatePath"
}

export interface StateInitCommand {
  readonly _tag: "StateInit"
  readonly repoUrl: string
  readonly repoRef: string
}

export interface StatePullCommand {
  readonly _tag: "StatePull"
}

export interface StatePushCommand {
  readonly _tag: "StatePush"
}

export interface StateStatusCommand {
  readonly _tag: "StateStatus"
}

export interface StateCommitCommand {
  readonly _tag: "StateCommit"
  readonly message: string
}

export interface StateSyncCommand {
  readonly _tag: "StateSync"
  readonly message: string | null
}

export type StateCommand =
  | StatePathCommand
  | StateInitCommand
  | StatePullCommand
  | StatePushCommand
  | StateStatusCommand
  | StateCommitCommand
  | StateSyncCommand
