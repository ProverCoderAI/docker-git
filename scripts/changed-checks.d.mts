export type ChangedCheckOperation = "check" | "lint" | "lint:effect" | "test" | "typecheck"

export interface WorkspacePackage {
  readonly dependencyNames: ReadonlyArray<string>
  readonly dir: string
  readonly name: string
  readonly scripts: Readonly<Record<string, string>>
}

export interface ChangedCheckCommand {
  readonly args: ReadonlyArray<string>
  readonly command: string
  readonly packageName: string
  readonly phase: string
  readonly serial: boolean
  readonly scriptName: string
}

export interface ChangedChecksPlan {
  readonly affectedPackages: ReadonlyArray<string>
  readonly changedFiles: ReadonlyArray<string>
  readonly commands: ReadonlyArray<ChangedCheckCommand>
  readonly mode: "affected" | "all" | "skip"
  readonly operation: ChangedCheckOperation
  readonly ownerPackages: ReadonlyArray<string>
  readonly reason: string
}

export interface CreateChangedChecksPlanInput {
  readonly all?: boolean
  readonly changedFiles: ReadonlyArray<string>
  readonly diffFailed?: boolean
  readonly operation: ChangedCheckOperation
  readonly packages: ReadonlyArray<WorkspacePackage>
}

export interface ChangedChecksCliArgs {
  readonly all: boolean
  readonly base: string
  readonly concurrency: number
  readonly dryRun: boolean
  readonly head: string
  readonly matrix: boolean
  readonly operation: ChangedCheckOperation
}

export interface GithubMatrix {
  readonly include: ReadonlyArray<Readonly<{
    readonly label: string
    readonly packageName: string
    readonly script: string
  }>>
}

export declare const createGithubMatrix: (plan: ChangedChecksPlan) => GithubMatrix
export declare const createChangedChecksPlan: (input: CreateChangedChecksPlanInput) => ChangedChecksPlan
export declare const loadWorkspacePackages: (rootDir?: string) => ReadonlyArray<WorkspacePackage>
export declare const parseChangedChecksArgs: (args: ReadonlyArray<string>) => ChangedChecksCliArgs
export declare const runChangedChecksCli: (argv: ReadonlyArray<string>, rootDir?: string) => Promise<number>
