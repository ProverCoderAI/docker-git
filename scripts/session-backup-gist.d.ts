export type SessionBackupFile = {
  readonly logicalName: string
  readonly sourcePath: string
  readonly size: number
}

export declare const collectSessionFiles: (
  dirPath: string,
  baseName: string,
  verbose: boolean
) => ReadonlyArray<SessionBackupFile>

export declare const shouldIgnoreSessionPath: (
  baseName: string,
  relativePath: string
) => boolean

declare const sessionBackupGist: {
  readonly collectSessionFiles: typeof collectSessionFiles
  readonly shouldIgnoreSessionPath: typeof shouldIgnoreSessionPath
}

export default sessionBackupGist
