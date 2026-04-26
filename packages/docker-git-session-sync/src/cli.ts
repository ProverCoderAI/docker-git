import { backupSessions, type BackupOptions, type Output } from "./backup.js"
import { downloadSnapshot, listSnapshots, viewSnapshot } from "./snapshots.js"

const defaultLimit = 20
const defaultOutputDir = "./.session-restore"

const usageText = `Usage:
  docker-git-session-sync backup [options]
  docker-git-session-sync list [options]
  docker-git-session-sync view <snapshot-ref> [options]
  docker-git-session-sync download <snapshot-ref> [options]

Options:
  --session-dir <path>    Path under ~/.codex/sessions or ~/.claude/projects
  --pr-number <number>    Open PR number to post comment to
  --repo <owner/repo>     Source repository or list filter
  --limit <number>        Maximum snapshots to list (default: 20)
  --output <path>         Download directory (default: ./.session-restore)
  --no-comment            Skip posting a PR comment after backup
  --dry-run               Show what backup would upload
  --verbose               Enable verbose logging
  --help                  Show help`

type ParsedCommand =
  | { readonly _tag: "Help" }
  | ({ readonly _tag: "Backup" } & BackupOptions)
  | { readonly _tag: "List"; readonly limit: number; readonly repo: string | null; readonly verbose: boolean }
  | { readonly _tag: "View"; readonly snapshotRef: string; readonly verbose: boolean }
  | { readonly _tag: "Download"; readonly snapshotRef: string; readonly outputDir: string; readonly verbose: boolean }

type ParseResult =
  | { readonly _tag: "Ok"; readonly command: ParsedCommand }
  | { readonly _tag: "Error"; readonly message: string }

const nextValue = (args: ReadonlyArray<string>, index: number, option: string): string | ParseResult => {
  const value = args[index + 1]
  if (value === undefined || value.startsWith("--")) {
    return { _tag: "Error", message: `${option} requires a value` }
  }
  return value
}

const parsePositiveInt = (option: string, value: string): number | ParseResult => {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : { _tag: "Error", message: `${option} must be a positive integer` }
}

const parseBackup = (args: ReadonlyArray<string>): ParseResult => {
  const options: {
    sessionDir: string | null
    prNumber: number | null
    repo: string | null
    postComment: boolean
    dryRun: boolean
    verbose: boolean
  } = {
    sessionDir: null,
    prNumber: null,
    repo: null,
    postComment: true,
    dryRun: false,
    verbose: false
  }
  let index = 0
  while (index < args.length) {
    const arg = args[index]
    if (arg === "--session-dir") {
      const value = nextValue(args, index, arg)
      if (typeof value !== "string") {
        return value
      }
      options.sessionDir = value
      index += 2
      continue
    }
    if (arg === "--pr-number") {
      const value = nextValue(args, index, arg)
      if (typeof value !== "string") {
        return value
      }
      const parsed = parsePositiveInt(arg, value)
      if (typeof parsed !== "number") {
        return parsed
      }
      options.prNumber = parsed
      index += 2
      continue
    }
    if (arg === "--repo") {
      const value = nextValue(args, index, arg)
      if (typeof value !== "string") {
        return value
      }
      options.repo = value
      index += 2
      continue
    }
    if (arg === "--no-comment") {
      options.postComment = false
      index += 1
      continue
    }
    if (arg === "--dry-run") {
      options.dryRun = true
      index += 1
      continue
    }
    if (arg === "--verbose") {
      options.verbose = true
      index += 1
      continue
    }
    return { _tag: "Error", message: `unknown backup option ${arg ?? ""}` }
  }
  return { _tag: "Ok", command: { _tag: "Backup", ...options } }
}

const parseList = (args: ReadonlyArray<string>): ParseResult => {
  let limit = defaultLimit
  let repo: string | null = null
  let verbose = false
  let index = 0
  while (index < args.length) {
    const arg = args[index]
    if (arg === "--limit") {
      const value = nextValue(args, index, arg)
      if (typeof value !== "string") {
        return value
      }
      const parsed = parsePositiveInt(arg, value)
      if (typeof parsed !== "number") {
        return parsed
      }
      limit = parsed
      index += 2
      continue
    }
    if (arg === "--repo") {
      const value = nextValue(args, index, arg)
      if (typeof value !== "string") {
        return value
      }
      repo = value
      index += 2
      continue
    }
    if (arg === "--verbose") {
      verbose = true
      index += 1
      continue
    }
    return { _tag: "Error", message: `unknown list option ${arg ?? ""}` }
  }
  return { _tag: "Ok", command: { _tag: "List", limit, repo, verbose } }
}

const extractSnapshotRef = (args: ReadonlyArray<string>): string | null => {
  const first = args[0]
  return first !== undefined && !first.startsWith("--") ? first : null
}

const parseView = (args: ReadonlyArray<string>): ParseResult => {
  const snapshotRef = extractSnapshotRef(args)
  if (snapshotRef === null) {
    return { _tag: "Error", message: "view requires <snapshot-ref>" }
  }
  const rest = args.slice(1)
  const verbose = rest.includes("--verbose")
  const unknown = rest.find((arg) => arg !== "--verbose")
  if (unknown !== undefined) {
    return { _tag: "Error", message: `unknown view option ${unknown}` }
  }
  return { _tag: "Ok", command: { _tag: "View", snapshotRef, verbose } }
}

const parseDownload = (args: ReadonlyArray<string>): ParseResult => {
  const snapshotRef = extractSnapshotRef(args)
  if (snapshotRef === null) {
    return { _tag: "Error", message: "download requires <snapshot-ref>" }
  }
  let outputDir = defaultOutputDir
  let verbose = false
  let index = 1
  while (index < args.length) {
    const arg = args[index]
    if (arg === "--output") {
      const value = nextValue(args, index, arg)
      if (typeof value !== "string") {
        return value
      }
      outputDir = value
      index += 2
      continue
    }
    if (arg === "--verbose") {
      verbose = true
      index += 1
      continue
    }
    return { _tag: "Error", message: `unknown download option ${arg ?? ""}` }
  }
  return { _tag: "Ok", command: { _tag: "Download", snapshotRef, outputDir, verbose } }
}

export const parseArgs = (args: ReadonlyArray<string>): ParseResult => {
  const command = args[0]
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    return { _tag: "Ok", command: { _tag: "Help" } }
  }
  const rest = args.slice(1)
  if (command === "backup") {
    return parseBackup(rest)
  }
  if (command === "list") {
    return parseList(rest)
  }
  if (command === "view") {
    return parseView(rest)
  }
  if (command === "download") {
    return parseDownload(rest)
  }
  return { _tag: "Error", message: `unknown command ${command}` }
}

const writeLine = (stream: NodeJS.WriteStream, message: string): void => {
  stream.write(`${message}\n`)
}

export const processOutput: Output = {
  out: (message) => writeLine(process.stdout, message),
  err: (message) => writeLine(process.stderr, message)
}

export const runCli = (
  args: ReadonlyArray<string>,
  cwd: string,
  output: Output = processOutput
): number => {
  const parsed = parseArgs(args)
  if (parsed._tag === "Error") {
    output.err(parsed.message)
    output.err(usageText)
    return 1
  }
  const command = parsed.command
  if (command._tag === "Help") {
    output.out(usageText)
    return 0
  }
  if (command._tag === "Backup") {
    return backupSessions(command, cwd, output)
  }
  if (command._tag === "List") {
    return listSnapshots(command, cwd, output)
  }
  if (command._tag === "View") {
    return viewSnapshot(command, cwd, output)
  }
  return downloadSnapshot(command, cwd, output)
}
