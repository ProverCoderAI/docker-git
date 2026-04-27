import fs from "node:fs"
import path from "node:path"

import { buildBlobUrl, sanitizeSnapshotRefForOutput } from "./core.js"
import { ensureBackupRepo, getFileContent, getTreeEntries, parseJsonBuffer, resolveGhEnvironment } from "./shell.js"
import type { BackupRepo, GhEnv, TreeEntry } from "./types.js"

import type { Output } from "./backup.js"

export interface ListOptions {
  readonly limit: number
  readonly repo: string | null
  readonly verbose: boolean
}

export interface ViewOptions {
  readonly snapshotRef: string
  readonly verbose: boolean
}

export interface DownloadOptions {
  readonly snapshotRef: string
  readonly outputDir: string
  readonly verbose: boolean
}

const logVerbose = (verbose: boolean, output: Output, message: string): void => {
  if (verbose) {
    output.out(`[session-backups] ${message}`)
  }
}

const ensureBackupRepoOrExit = (ghEnv: GhEnv, verbose: boolean, output: Output): BackupRepo | null => {
  const backupRepo = ensureBackupRepo(ghEnv, (message) => logVerbose(verbose, output, message), false)
  if (backupRepo === null) {
    output.out("No private session backup repository found.")
  }
  return backupRepo
}

const getManifestRepoPath = (snapshotRef: string): string => `${snapshotRef}/manifest.json`

const fetchManifest = (backupRepo: BackupRepo, snapshotRef: string, ghEnv: GhEnv): {
  readonly path: string
  readonly data: unknown
} => {
  const manifestPath = getManifestRepoPath(snapshotRef)
  return {
    path: manifestPath,
    data: parseJsonBuffer(getFileContent(backupRepo.fullName, manifestPath, ghEnv, backupRepo.defaultBranch), manifestPath)
  }
}

const isManifestPathEntry = (entry: TreeEntry): boolean =>
  entry.type === "blob" && entry.path.endsWith("/manifest.json")

const sourceField = (manifestData: unknown, key: string): string => {
  if (typeof manifestData !== "object" || manifestData === null || Array.isArray(manifestData)) {
    return ""
  }
  const source = Reflect.get(manifestData, "source")
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    return ""
  }
  const field = Reflect.get(source, key)
  return typeof field === "string" ? field : ""
}

const createdAtField = (manifestData: unknown): string => {
  if (typeof manifestData !== "object" || manifestData === null || Array.isArray(manifestData)) {
    return ""
  }
  const field = Reflect.get(manifestData, "createdAt")
  return typeof field === "string" ? field : ""
}

export const listSnapshots = (options: ListOptions, cwd: string, output: Output): number => {
  const ghEnv = resolveGhEnvironment(cwd, (message) => logVerbose(options.verbose, output, message))
  const backupRepo = ensureBackupRepoOrExit(ghEnv, options.verbose, output)
  if (backupRepo === null) {
    return 0
  }

  logVerbose(options.verbose, output, `Listing snapshots from ${backupRepo.fullName}`)
  const manifestPaths = getTreeEntries(backupRepo.fullName, backupRepo.defaultBranch, ghEnv).entries
    .filter(isManifestPathEntry)
    .map((entry) => entry.path)
  const filtered = options.repo === null
    ? manifestPaths
    : manifestPaths.filter((entryPath) => entryPath.startsWith(`${options.repo}/`))

  if (filtered.length === 0) {
    output.out("No session snapshots found.")
    if (options.repo !== null) {
      output.out(`(Filtered by repo: ${options.repo})`)
    }
    return 0
  }

  output.out("Session Snapshots:\n")
  for (const manifestPath of filtered.slice(0, options.limit)) {
    const snapshotRef = manifestPath.slice(0, -"/manifest.json".length)
    const manifest = fetchManifest(backupRepo, snapshotRef, ghEnv)
    output.out(snapshotRef)
    output.out(`  Source: ${sourceField(manifest.data, "repo")}`)
    output.out(`  Commit: ${sourceField(manifest.data, "commitSha")}`)
    output.out(`  Created: ${createdAtField(manifest.data)}`)
    output.out(`  Manifest: ${buildBlobUrl(backupRepo.fullName, backupRepo.defaultBranch, manifest.path)}`)
    output.out("")
  }
  output.out(`Total: ${filtered.length} snapshot(s)`)
  return 0
}

export const viewSnapshot = (options: ViewOptions, cwd: string, output: Output): number => {
  const ghEnv = resolveGhEnvironment(cwd, (message) => logVerbose(options.verbose, output, message))
  const backupRepo = ensureBackupRepoOrExit(ghEnv, options.verbose, output)
  if (backupRepo === null) {
    return 0
  }
  logVerbose(options.verbose, output, `Viewing snapshot: ${options.snapshotRef}`)
  const manifest = fetchManifest(backupRepo, options.snapshotRef, ghEnv)
  output.out(JSON.stringify(manifest.data, null, 2))
  return 0
}

const manifestFiles = (manifestData: unknown): ReadonlyArray<unknown> => {
  if (typeof manifestData !== "object" || manifestData === null || Array.isArray(manifestData)) {
    return []
  }
  const files = Reflect.get(manifestData, "files")
  return Array.isArray(files) ? files : []
}

const fileString = (file: unknown, key: string): string | null => {
  if (typeof file !== "object" || file === null || Array.isArray(file)) {
    return null
  }
  const field = Reflect.get(file, key)
  return typeof field === "string" ? field : null
}

const fileParts = (file: unknown): ReadonlyArray<unknown> => {
  if (typeof file !== "object" || file === null || Array.isArray(file)) {
    return []
  }
  const parts = Reflect.get(file, "parts")
  return Array.isArray(parts) ? parts : []
}

export const downloadSnapshot = (options: DownloadOptions, cwd: string, output: Output): number => {
  const ghEnv = resolveGhEnvironment(cwd, (message) => logVerbose(options.verbose, output, message))
  const backupRepo = ensureBackupRepoOrExit(ghEnv, options.verbose, output)
  if (backupRepo === null) {
    return 0
  }
  logVerbose(options.verbose, output, `Downloading snapshot ${options.snapshotRef} to ${options.outputDir}`)
  const manifest = fetchManifest(backupRepo, options.snapshotRef, ghEnv)
  const outputPath = path.resolve(options.outputDir, sanitizeSnapshotRefForOutput(options.snapshotRef))
  fs.mkdirSync(outputPath, { recursive: true })
  fs.writeFileSync(path.join(outputPath, "manifest.json"), `${JSON.stringify(manifest.data, null, 2)}\n`, "utf8")

  for (const file of manifestFiles(manifest.data)) {
    const name = fileString(file, "name")
    if (name === null) {
      continue
    }
    const targetPath = path.join(outputPath, name)
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    if (fileString(file, "type") === "chunked") {
      const buffers = fileParts(file)
        .map((part) => fileString(part, "repoPath"))
        .filter((repoPath): repoPath is string => repoPath !== null)
        .map((repoPath) => getFileContent(backupRepo.fullName, repoPath, ghEnv, backupRepo.defaultBranch))
      fs.writeFileSync(targetPath, Buffer.concat(buffers))
      continue
    }
    const repoPath = fileString(file, "repoPath")
    if (repoPath !== null) {
      fs.writeFileSync(targetPath, getFileContent(backupRepo.fullName, repoPath, ghEnv, backupRepo.defaultBranch))
    }
  }

  output.out(`Downloaded snapshot to: ${outputPath}`)
  output.out("\nTo restore session files, copy them to the appropriate location:")
  output.out("  - .codex/sessions/... -> ~/.codex/sessions/")
  output.out("  - .claude/projects/... -> ~/.claude/projects/")
  return 0
}
