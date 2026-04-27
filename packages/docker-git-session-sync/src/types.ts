export type Log = (message: string) => void

export type GhEnv = NodeJS.ProcessEnv

export interface BackupRepo {
  readonly owner: string
  readonly repo: string
  readonly fullName: string
  readonly defaultBranch: string
  readonly htmlUrl: string
}

export interface SessionFile {
  readonly logicalName: string
  readonly sourcePath: string
  readonly size: number
}

export interface UploadEntry {
  readonly repoPath: string
  readonly sourcePath: string
  readonly type?: string
  readonly size: number
  readonly blobSha: string
}

export interface SourceInfo {
  readonly repo: string
  readonly branch: string
  readonly prNumber: number | null
  readonly commitSha: string
  readonly createdAt: string
}

export interface ManifestFile {
  readonly type: "file"
  readonly name: string
  readonly size: number
  readonly repoPath: string
  readonly url: string
  readonly blobSha?: string
}

export interface ChunkedManifestPart {
  readonly name: string
  readonly repoPath: string
  readonly url: string
  readonly blobSha?: string
}

export interface ChunkedManifestFile {
  readonly type: "chunked"
  readonly name: string
  readonly originalSize: number
  readonly chunkManifestPath: string
  readonly chunkManifestUrl: string
  readonly chunkManifestBlobSha?: string
  readonly parts: ReadonlyArray<ChunkedManifestPart>
}

export type SnapshotManifestFile = ManifestFile | ChunkedManifestFile

export interface SnapshotManifest {
  readonly version: 1
  readonly createdAt: string
  readonly storage: {
    readonly repo: string
    readonly branch: string
    readonly snapshotRef: string
  }
  readonly source: SourceInfo
  readonly files: ReadonlyArray<SnapshotManifestFile>
}

export interface PreparedUploadArtifacts {
  readonly uploadEntries: ReadonlyArray<UploadEntry>
  readonly manifestFiles: ReadonlyArray<SnapshotManifestFile>
}

export interface FileSummary {
  readonly fileCount: number
  readonly totalBytes: number
}

export type CommentUploadState =
  | { readonly state: "queued" }
  | { readonly state: "skipped"; readonly message: string }
  | {
    readonly state: "success"
    readonly manifestUrl: string
    readonly readmeUrl: string
    readonly summary: FileSummary
  }
  | { readonly state: "failed"; readonly message: string }

export interface PrComment {
  readonly id: number
  readonly url: string
}

export interface TreeEntry {
  readonly path: string
  readonly mode: string
  readonly type: string
  readonly sha: string
}

export interface TreeSnapshot {
  readonly headSha?: string
  readonly treeSha: string
  readonly entries: ReadonlyArray<TreeEntry>
}
