#!/usr/bin/env node

/**
 * Session Backup to a private GitHub repository
 *
 * This script backs up AI agent session files (~/.codex, ~/.claude, ~/.qwen, ~/.gemini)
 * to a dedicated private repository and optionally posts a comment to the
 * associated PR with direct links to the uploaded files.
 *
 * Usage:
 *   node scripts/session-backup-gist.js [options]
 *
 * Options:
 *   --session-dir <path>    Path to session directory under $HOME (default: auto-detect ~/.codex, ~/.claude, ~/.qwen, or ~/.gemini)
 *   --pr-number <number>    PR number to post comment to (optional, auto-detected from branch)
 *   --repo <owner/repo>     Source repository (optional, auto-detected from git remote)
 *   --no-comment            Skip posting PR comment
 *   --dry-run               Show what would be uploaded without actually uploading
 *   --verbose               Enable verbose logging
 *
 * Environment:
 *   DOCKER_GIT_SKIP_SESSION_BACKUP=1  Skip session backup entirely
 *
 * @pure false - contains IO effects (file system, network, git commands)
 * @effect FileSystem, ProcessExec, GitHubRepo
 */

const fs = require("node:fs");
const path = require("node:path");
const { execSync, spawnSync } = require("node:child_process");
const os = require("node:os");

const {
  buildBlobUrl,
  buildSnapshotRef,
  ensureBackupRepo,
  resolveGhEnvironment,
  prepareUploadArtifacts,
  uploadSnapshot,
} = require("./session-backup-repo.js");

const SESSION_DIR_NAMES = [".codex", ".claude", ".qwen", ".gemini"];

const isPathWithinParent = (targetPath, parentPath) => {
  const relative = path.relative(parentPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const getAllowedSessionRoots = () => {
  const homeDir = os.homedir();
  return SESSION_DIR_NAMES.map((dirName) => ({
    name: dirName,
    path: path.join(homeDir, dirName),
  })).filter((entry) => fs.existsSync(entry.path));
};

const resolveAllowedSessionDir = (candidatePath, verbose) => {
  const resolvedPath = path.resolve(candidatePath);
  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  for (const root of getAllowedSessionRoots()) {
    if (isPathWithinParent(resolvedPath, root.path)) {
      return resolvedPath;
    }
  }

  log(verbose, `Skipping non-session directory: ${candidatePath}`);
  return null;
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const result = {
    sessionDir: null,
    prNumber: null,
    repo: null,
    postComment: true,
    dryRun: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--session-dir":
        result.sessionDir = args[++i];
        break;
      case "--pr-number":
        result.prNumber = parseInt(args[++i], 10);
        break;
      case "--repo":
        result.repo = args[++i];
        break;
      case "--no-comment":
        result.postComment = false;
        break;
      case "--dry-run":
        result.dryRun = true;
        break;
      case "--verbose":
        result.verbose = true;
        break;
      case "--help":
        console.log(`Usage: session-backup-gist.js [options]

Options:
  --session-dir <path>    Path to session directory under $HOME
  --pr-number <number>    PR number to post comment to
  --repo <owner/repo>     Source repository
  --no-comment            Skip posting PR comment
  --dry-run               Show what would be uploaded
  --verbose               Enable verbose logging
  --help                  Show this help message`);
        process.exit(0);
    }
  }

  return result;
};

const log = (verbose, message) => {
  if (verbose) {
    console.log(`[session-backup] ${message}`);
  }
};

const execCommand = (command, options = {}) => {
  try {
    return execSync(command, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      ...options,
    }).trim();
  } catch {
    return null;
  }
};

const ghCommand = (args, ghEnv) => {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: ghEnv,
  });

  return {
    success: result.status === 0,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
};

const parseGitHubRepoFromRemoteUrl = (remoteUrl) => {
  if (!remoteUrl) {
    return null;
  }

  const sshMatch = remoteUrl.match(/git@github\.com:([^/]+\/[^.]+)(?:\.git)?$/);
  if (sshMatch) {
    return sshMatch[1];
  }

  const httpsMatch = remoteUrl.match(/https:\/\/github\.com\/([^/]+\/[^.]+)(?:\.git)?$/);
  if (httpsMatch) {
    return httpsMatch[1];
  }

  return null;
};

const rankRemoteName = (remoteName) => {
  if (remoteName === "upstream") {
    return 0;
  }
  if (remoteName === "origin") {
    return 1;
  }
  return 2;
};

const getCurrentBranch = () => execCommand("git rev-parse --abbrev-ref HEAD");

const getHeadCommitSha = () => execCommand("git rev-parse HEAD");

const getRepoCandidates = (explicitRepo, verbose) => {
  if (explicitRepo) {
    return [explicitRepo];
  }

  const remoteOutput = execCommand("git remote -v");
  if (!remoteOutput) {
    return [];
  }

  const remotes = [];
  const seenRepos = new Set();

  for (const line of remoteOutput.split("\n")) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (!match || match[3] !== "fetch") {
      continue;
    }

    const [, remoteName, remoteUrl] = match;
    const repo = parseGitHubRepoFromRemoteUrl(remoteUrl);
    if (!repo || seenRepos.has(repo)) {
      continue;
    }

    remotes.push({ remoteName, repo });
    seenRepos.add(repo);
  }

  remotes.sort((left, right) => {
    const rankDiff = rankRemoteName(left.remoteName) - rankRemoteName(right.remoteName);
    return rankDiff !== 0 ? rankDiff : left.remoteName.localeCompare(right.remoteName);
  });

  const repos = remotes.map(({ repo }) => repo);
  if (repos.length > 0) {
    log(verbose, `Repository candidates: ${repos.join(", ")}`);
  }
  return repos;
};

const getPrNumberFromBranch = (repo, branch, ghEnv) => {
  const result = ghCommand([
    "pr",
    "list",
    "--repo",
    repo,
    "--head",
    branch,
    "--json",
    "number",
    "--jq",
    ".[0].number",
  ], ghEnv);

  if (result.success && result.stdout && !Number.isNaN(parseInt(result.stdout, 10))) {
    return parseInt(result.stdout, 10);
  }
  return null;
};

const prExists = (repo, prNumber, ghEnv) => {
  const result = ghCommand([
    "pr",
    "view",
    prNumber.toString(),
    "--repo",
    repo,
    "--json",
    "number",
    "--jq",
    ".number",
  ], ghEnv);

  return result.success && result.stdout === prNumber.toString();
};

const getPrNumberFromWorkspaceBranch = (branch) => {
  const match = branch.match(/^pr-refs-pull-([0-9]+)-head$/);
  if (!match) {
    return null;
  }

  const prNumber = parseInt(match[1], 10);
  return Number.isNaN(prNumber) ? null : prNumber;
};

const findPrContext = (repos, branch, verbose, ghEnv) => {
  for (const repo of repos) {
    log(verbose, `Checking open PR in ${repo} for branch ${branch}`);
    const prNumber = getPrNumberFromBranch(repo, branch, ghEnv);
    if (prNumber !== null) {
      return { repo, prNumber };
    }
  }

  const workspacePrNumber = getPrNumberFromWorkspaceBranch(branch);
  if (workspacePrNumber === null) {
    return null;
  }

  for (const repo of repos) {
    log(verbose, `Checking workspace PR #${workspacePrNumber} in ${repo} for branch ${branch}`);
    if (prExists(repo, workspacePrNumber, ghEnv)) {
      return { repo, prNumber: workspacePrNumber };
    }
  }

  return null;
};

const findSessionDirs = (explicitPath, verbose) => {
  const dirs = [];

  if (explicitPath) {
    const allowedPath = resolveAllowedSessionDir(path.resolve(explicitPath), verbose);
    if (allowedPath === null) {
      console.error(
        `[session-backup] --session-dir must point to a directory under ${SESSION_DIR_NAMES
          .map((dirName) => `~/${dirName}`)
          .join(", ")}`
      );
      process.exit(1);
    }
    dirs.push({ name: path.basename(allowedPath), path: allowedPath });
    return dirs;
  }

  for (const root of getAllowedSessionRoots()) {
    const allowedPath = resolveAllowedSessionDir(root.path, verbose);
    if (allowedPath !== null) {
      log(verbose, `Found session directory: ${allowedPath}`);
      dirs.push({ name: root.name, path: allowedPath });
    }
  }

  return dirs;
};

const collectSessionFiles = (dirPath, baseName, verbose) => {
  const files = [];

  const walk = (currentPath, relativePath) => {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") {
          continue;
        }
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        try {
          const stats = fs.statSync(fullPath);
          const logicalName = path.posix.join(baseName, relPath.split(path.sep).join(path.posix.sep));
          files.push({
            logicalName,
            sourcePath: fullPath,
            size: stats.size,
          });
          log(verbose, `Collected file: ${logicalName} (${stats.size} bytes)`);
        } catch (error) {
          log(verbose, `Error reading file ${fullPath}: ${error.message}`);
        }
      }
    }
  };

  walk(dirPath, "");
  return files;
};

const buildManifest = ({ backupRepo, snapshotRef, source, files, createdAt }) => ({
  version: 1,
  createdAt,
  storage: {
    repo: backupRepo.fullName,
    branch: backupRepo.defaultBranch,
    snapshotRef,
  },
  source,
  files,
});

const formatBytes = (bytes) => {
  if (bytes >= 1_000_000_000) {
    return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  }
  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(2)} MB`;
  }
  if (bytes >= 1_000) {
    return `${(bytes / 1_000).toFixed(2)} KB`;
  }
  return `${bytes} B`;
};

const summarizeFiles = (files) => ({
  fileCount: files.length,
  totalBytes: files.reduce(
    (sum, file) => sum + (file.type === "chunked" ? (file.originalSize ?? 0) : (file.size ?? 0)),
    0
  ),
});

const buildSnapshotReadme = ({ backupRepo, source, manifestUrl, summary, sessionRoots }) =>
  [
    "# AI Session Backup",
    "",
    "This snapshot contains AI session data used during development.",
    "",
    `- Backup Repo: \`${backupRepo.fullName}\``,
    `- Source Repo: \`${source.repo}\``,
    `- Source Branch: \`${source.branch}\``,
    `- Source Commit: \`${source.commitSha}\``,
    source.prNumber === null ? "- Pull Request: none" : `- Pull Request: #${source.prNumber}`,
    `- Created At: \`${source.createdAt}\``,
    `- Files: \`${summary.fileCount}\``,
    `- Total Size: \`${formatBytes(summary.totalBytes)}\``,
    `- Session Roots: \`${sessionRoots.join("`, `")}\``,
    "",
    `- Manifest: ${manifestUrl}`,
    "",
    "Generated automatically by the docker-git `pre-push` session backup hook.",
    "",
  ].join("\n");

const buildCommentBody = ({ backupRepo, source, manifestUrl, readmeUrl, summary }) => {
  const lines = [
    "## AI Session Backup",
    "",
    "A snapshot of the AI session context used during development has been saved.",
    "",
    `Backup Repo: ${backupRepo.fullName}`,
    `Source Commit: ${source.commitSha}`,
    `Created At: ${source.createdAt}`,
    `Files: ${summary.fileCount} (${formatBytes(summary.totalBytes)})`,
    "",
    `README: ${readmeUrl}`,
    `Manifest: ${manifestUrl}`,
    "",
    "This snapshot metadata was used during development.",
  ];

  lines.push(`<!-- docker-git-session-backup:${source.commitSha}:${source.createdAt} -->`);
  return lines.join("\n");
};

const postPrComment = (repo, prNumber, comment, verbose, ghEnv) => {
  log(verbose, `Posting comment to PR #${prNumber}`);

  const result = ghCommand([
    "pr",
    "comment",
    prNumber.toString(),
    "--repo",
    repo,
    "--body",
    comment,
  ], ghEnv);

  if (!result.success) {
    console.error(`[session-backup] Failed to post PR comment: ${result.stderr}`);
    return false;
  }

  log(verbose, "Comment posted successfully");
  return true;
};

const main = () => {
  if (process.env.DOCKER_GIT_SKIP_SESSION_BACKUP === "1") {
    console.log("[session-backup] Skipped (DOCKER_GIT_SKIP_SESSION_BACKUP=1)");
    return;
  }

  const args = parseArgs();
  const verbose = args.verbose;
  const ghEnv = resolveGhEnvironment(process.cwd(), (message) => log(verbose, message));

  log(verbose, "Starting session backup...");

  const repoCandidates = getRepoCandidates(args.repo, verbose);
  if (repoCandidates.length === 0) {
    console.error("[session-backup] Could not determine source repository. Use --repo option.");
    process.exit(1);
  }
  const sourceRepo = repoCandidates[0];
  log(verbose, `Repository: ${sourceRepo}`);

  const branch = getCurrentBranch();
  if (!branch) {
    console.error("[session-backup] Could not determine current branch.");
    process.exit(1);
  }
  log(verbose, `Branch: ${branch}`);

  const commitSha = getHeadCommitSha();
  if (!commitSha) {
    console.error("[session-backup] Could not determine current commit.");
    process.exit(1);
  }

  let prContext = null;
  if (args.prNumber !== null) {
    prContext = { repo: sourceRepo, prNumber: args.prNumber };
  } else if (args.postComment) {
    prContext = findPrContext(repoCandidates, branch, verbose, ghEnv);
  }

  if (prContext !== null) {
    log(verbose, `PR number: ${prContext.prNumber} (${prContext.repo})`);
  } else if (args.postComment) {
    log(verbose, "No PR found for current branch, skipping comment");
  }

  const sessionDirs = findSessionDirs(args.sessionDir, verbose);
  if (sessionDirs.length === 0) {
    log(verbose, "No session directories found");
    return;
  }

  const sessionFiles = [];
  for (const dir of sessionDirs) {
    sessionFiles.push(...collectSessionFiles(dir.path, dir.name, verbose));
  }

  if (sessionFiles.length === 0) {
    log(verbose, "No session files found to backup");
    return;
  }
  log(verbose, `Total files to backup: ${sessionFiles.length}`);

  const backupRepo = ensureBackupRepo(ghEnv, (message) => log(verbose, message), !args.dryRun);
  if (backupRepo === null) {
    console.error("[session-backup] Failed to resolve or create the private session backup repository");
    process.exit(1);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-backup-repo-"));

  try {
    const snapshotCreatedAt = new Date().toISOString();
    const snapshotRef = buildSnapshotRef(sourceRepo, prContext?.prNumber ?? null, commitSha, snapshotCreatedAt);
    const prepared = prepareUploadArtifacts(
      sessionFiles,
      snapshotRef,
      backupRepo.fullName,
      backupRepo.defaultBranch,
      tmpDir,
      (message) => log(verbose, message)
    );

    const source = {
      repo: sourceRepo,
      branch,
      prNumber: prContext?.prNumber ?? null,
      commitSha,
      createdAt: snapshotCreatedAt,
    };
    const summary = summarizeFiles(prepared.manifestFiles);
    const sessionRoots = sessionDirs.map((dir) => `~/${dir.name}`);
    const manifestUrl = buildBlobUrl(backupRepo.fullName, backupRepo.defaultBranch, `${snapshotRef}/manifest.json`);
    const readmeRepoPath = `${snapshotRef}/README.md`;
    const readmeUrl = buildBlobUrl(backupRepo.fullName, backupRepo.defaultBranch, readmeRepoPath);

    const manifest = buildManifest({
      backupRepo,
      snapshotRef,
      source,
      files: prepared.manifestFiles,
      createdAt: snapshotCreatedAt,
    });
    const readmePath = path.join(tmpDir, "README.md");
    fs.writeFileSync(
      readmePath,
      buildSnapshotReadme({
        backupRepo,
        source,
        manifestUrl,
        summary,
        sessionRoots,
      }),
      "utf8"
    );
    const uploadEntries = [
      ...prepared.uploadEntries,
      {
        repoPath: readmeRepoPath,
        sourcePath: readmePath,
        type: "readme",
        size: fs.statSync(readmePath).size,
      },
    ];
    if (args.dryRun) {
      console.log(`[dry-run] Would upload snapshot to ${backupRepo.fullName}:${snapshotRef}`);
      console.log(`[dry-run] Would write ${uploadEntries.length + 1} file(s) including README and manifest.`);
      console.log(`[dry-run] README URL: ${readmeUrl}`);
      console.log(`[dry-run] Manifest URL: ${manifestUrl}`);
      if (args.postComment && prContext !== null) {
        console.log(`[dry-run] Would post comment to PR #${prContext.prNumber} in ${prContext.repo}:`);
        console.log(buildCommentBody({ backupRepo, source, manifestUrl, readmeUrl, summary }));
      }
      return;
    }

    log(verbose, `Uploading snapshot to ${backupRepo.fullName}:${snapshotRef}`);
    const uploadResult = uploadSnapshot(
      backupRepo,
      snapshotRef,
      manifest,
      uploadEntries,
      ghEnv
    );

    console.log(`[session-backup] Uploaded snapshot to ${backupRepo.fullName}`);
    console.log(`[session-backup] README: ${readmeUrl}`);
    console.log(`[session-backup] Manifest: ${uploadResult.manifestUrl}`);

    if (args.postComment && prContext !== null) {
      const comment = buildCommentBody({
        backupRepo,
        source,
        manifestUrl: uploadResult.manifestUrl,
        readmeUrl,
        summary,
      });
      postPrComment(prContext.repo, prContext.prNumber, comment, verbose, ghEnv);
    }

    console.log("[session-backup] Session backup complete");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};

main();
