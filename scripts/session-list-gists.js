#!/usr/bin/env node

/**
 * List AI Session Backups from the private session backup repository
 *
 * Usage:
 *   node scripts/session-list-gists.js [command] [options]
 *
 * Commands:
 *   list                        List session snapshots (default)
 *   view <snapshot-ref>         View metadata for a snapshot
 *   download <snapshot-ref>     Download snapshot contents to local directory
 *
 * Options:
 *   --limit <number>            Maximum number of snapshots to list (default: 20)
 *   --repo <owner/repo>         Filter by source repository
 *   --output <path>             Output directory for download (default: ./.session-restore)
 *   --verbose                   Enable verbose logging
 */

const fs = require("node:fs");
const path = require("node:path");

const {
  ensureBackupRepo,
  getFileContent,
  getTreeEntries,
  resolveGhEnvironment,
  sanitizeSnapshotRefForOutput,
} = require("./session-backup-repo.js");

const parseArgs = () => {
  const args = process.argv.slice(2);
  const result = {
    command: "list",
    snapshotRef: null,
    limit: 20,
    repo: null,
    output: "./.session-restore",
    verbose: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg.startsWith("--")) {
      switch (arg) {
        case "--limit":
          result.limit = parseInt(args[++i], 10);
          break;
        case "--repo":
          result.repo = args[++i];
          break;
        case "--output":
          result.output = args[++i];
          break;
        case "--verbose":
          result.verbose = true;
          break;
        case "--help":
          console.log(`Usage: session-list-gists.js [command] [options]

Commands:
  list                        List session snapshots (default)
  view <snapshot-ref>         View metadata for a snapshot
  download <snapshot-ref>     Download snapshot contents to local directory

Options:
  --limit <number>            Maximum number of snapshots to list (default: 20)
  --repo <owner/repo>         Filter by source repository
  --output <path>             Output directory for download (default: ./.session-restore)
  --verbose                   Enable verbose logging
  --help                      Show this help message`);
          process.exit(0);
      }
    } else if (!result.command || result.command === "list") {
      if (arg === "list" || arg === "view" || arg === "download") {
        result.command = arg;
      } else if (result.command !== "list") {
        result.snapshotRef = arg;
      }
    } else if (!result.snapshotRef) {
      result.snapshotRef = arg;
    }
    i++;
  }

  return result;
};

const log = (verbose, message) => {
  if (verbose) {
    console.log(`[session-backups] ${message}`);
  }
};

const ensureBackupRepoOrExit = (ghEnv, verbose) => {
  const backupRepo = ensureBackupRepo(ghEnv, (message) => log(verbose, message), false);
  if (backupRepo === null) {
    console.log("No private session backup repository found.");
    process.exit(0);
  }
  return backupRepo;
};

const decodeJsonBuffer = (buffer, context) => {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    console.error(`Failed to parse JSON for ${context}: ${error.message}`);
    process.exit(1);
  }
};

const getManifestRepoPath = (snapshotRef) => `${snapshotRef}/manifest.json`;

const fetchManifest = (backupRepo, snapshotRef, ghEnv) => {
  const manifestPath = getManifestRepoPath(snapshotRef);
  const buffer = getFileContent(backupRepo.fullName, manifestPath, ghEnv, backupRepo.defaultBranch);
  return {
    path: manifestPath,
    data: decodeJsonBuffer(buffer, manifestPath),
  };
};

const listSnapshots = (limit, repoFilter, backupRepo, ghEnv, verbose) => {
  log(verbose, `Listing snapshots from ${backupRepo.fullName}`);
  const { entries } = getTreeEntries(backupRepo.fullName, backupRepo.defaultBranch, ghEnv);
  const manifestPaths = entries
    .filter((entry) => entry.type === "blob" && typeof entry.path === "string" && entry.path.endsWith("/manifest.json"))
    .map((entry) => entry.path);

  const filtered = repoFilter
    ? manifestPaths.filter((entryPath) => entryPath.startsWith(`${repoFilter}/`))
    : manifestPaths;

  if (filtered.length === 0) {
    console.log("No session snapshots found.");
    if (repoFilter) {
      console.log(`(Filtered by repo: ${repoFilter})`);
    }
    return;
  }

  const selected = filtered.slice(0, limit);
  console.log("Session Snapshots:\n");
  for (const manifestPath of selected) {
    const snapshotRef = manifestPath.slice(0, -"/manifest.json".length);
    const manifest = fetchManifest(backupRepo, snapshotRef, ghEnv);
    console.log(snapshotRef);
    console.log(`  Source: ${manifest.data.source.repo}`);
    console.log(`  Commit: ${manifest.data.source.commitSha}`);
    console.log(`  Created: ${manifest.data.createdAt}`);
    console.log(`  Manifest: https://github.com/${backupRepo.fullName}/blob/${encodeURIComponent(backupRepo.defaultBranch)}/${manifest.path.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`);
    console.log("");
  }

  console.log(`Total: ${filtered.length} snapshot(s)`);
};

const viewSnapshot = (snapshotRef, backupRepo, ghEnv, verbose) => {
  if (!snapshotRef) {
    console.error("Error: snapshot-ref is required for view command");
    process.exit(1);
  }

  log(verbose, `Viewing snapshot: ${snapshotRef}`);
  const manifest = fetchManifest(backupRepo, snapshotRef, ghEnv);
  console.log(JSON.stringify(manifest.data, null, 2));
};

const downloadSnapshot = (snapshotRef, outputDir, backupRepo, ghEnv, verbose) => {
  if (!snapshotRef) {
    console.error("Error: snapshot-ref is required for download command");
    process.exit(1);
  }

  log(verbose, `Downloading snapshot ${snapshotRef} to ${outputDir}`);
  const manifest = fetchManifest(backupRepo, snapshotRef, ghEnv);
  const outputPath = path.resolve(outputDir, sanitizeSnapshotRefForOutput(snapshotRef));
  fs.mkdirSync(outputPath, { recursive: true });
  fs.writeFileSync(path.join(outputPath, "manifest.json"), `${JSON.stringify(manifest.data, null, 2)}\n`, "utf8");

  for (const file of manifest.data.files) {
    const targetPath = path.join(outputPath, file.name);
    if (file.type === "chunked") {
      const buffers = file.parts.map((part) =>
        getFileContent(backupRepo.fullName, part.repoPath, ghEnv, backupRepo.defaultBranch)
      );
      fs.writeFileSync(targetPath, Buffer.concat(buffers));
      continue;
    }

    const buffer = getFileContent(backupRepo.fullName, file.repoPath, ghEnv, backupRepo.defaultBranch);
    fs.writeFileSync(targetPath, buffer);
  }

  console.log(`Downloaded snapshot to: ${outputPath}`);
  console.log("\nTo restore session files, copy them to the appropriate location:");
  console.log("  - .codex_* files -> ~/.codex/");
  console.log("  - .claude_* files -> ~/.claude/");
  console.log("  - .gemini_* files -> ~/.gemini/");
  console.log("  - .knowledge_* files -> ./.knowledge/");
};

const main = () => {
  const args = parseArgs();
  const verbose = args.verbose;
  const ghEnv = resolveGhEnvironment(process.cwd(), (message) => log(verbose, message));
  const backupRepo = ensureBackupRepoOrExit(ghEnv, verbose);

  switch (args.command) {
    case "list":
      listSnapshots(args.limit, args.repo, backupRepo, ghEnv, verbose);
      break;
    case "view":
      viewSnapshot(args.snapshotRef, backupRepo, ghEnv, verbose);
      break;
    case "download":
      downloadSnapshot(args.snapshotRef, args.output, backupRepo, ghEnv, verbose);
      break;
    default:
      console.error(`Unknown command: ${args.command}`);
      process.exit(1);
  }
};

main();
