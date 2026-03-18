#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const BACKUP_REPO_NAME = "docker-git-sessions";
const BACKUP_DEFAULT_BRANCH = "main";
// GitHub's git/blob API receives base64-encoded payloads, so files near 100 MB
// exceed the practical request size limit even though normal git push could handle them.
// Keep API uploads comfortably below that ceiling.
const MAX_REPO_FILE_SIZE = 50 * 1000 * 1000;
const CHUNK_MANIFEST_SUFFIX = ".chunks.json";
const DOCKER_GIT_CONFIG_FILE = "docker-git.json";
const GITHUB_ENV_KEYS = ["GITHUB_TOKEN", "GH_TOKEN"];

const parseEnvText = (text) => {
  const entries = [];

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) {
      continue;
    }
    entries.push({ key: match[1], value: match[2] });
  }

  return entries;
};

const findGithubTokenInEnvText = (text) => {
  const entries = parseEnvText(text);

  for (const key of GITHUB_ENV_KEYS) {
    const entry = entries.find((item) => item.key === key);
    const token = entry?.value?.trim() ?? "";
    if (token.length > 0) {
      return { key, token };
    }
  }

  return null;
};

const getDockerGitProjectsRoot = () => {
  const configured = process.env.DOCKER_GIT_PROJECTS_ROOT?.trim();
  if (configured && configured.length > 0) {
    return configured;
  }
  return path.join(os.homedir(), ".docker-git");
};

const readJsonFile = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};

const findDockerGitProjectForTarget = (projectsRoot, targetDir, log) => {
  if (!fs.existsSync(projectsRoot)) {
    return null;
  }

  const stack = [projectsRoot];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    const configPath = path.join(currentDir, DOCKER_GIT_CONFIG_FILE);
    if (fs.existsSync(configPath)) {
      const config = readJsonFile(configPath);
      const candidateTarget = config?.template?.targetDir;
      if (typeof candidateTarget === "string" && candidateTarget === targetDir) {
        log(`Resolved docker-git project config: ${configPath}`);
        return { configPath, config };
      }
    }

    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".cache") {
        continue;
      }
      stack.push(path.join(currentDir, entry.name));
    }
  }

  return null;
};

const getGithubEnvFileCandidates = (repoRoot, log) => {
  const projectsRoot = getDockerGitProjectsRoot();
  const candidates = [];
  const seen = new Set();

  const project = findDockerGitProjectForTarget(projectsRoot, repoRoot, log);
  const projectEnvGlobal = project?.config?.template?.envGlobalPath;
  if (project?.configPath && typeof projectEnvGlobal === "string" && projectEnvGlobal.length > 0) {
    const projectEnvPath = path.resolve(path.dirname(project.configPath), projectEnvGlobal);
    candidates.push(projectEnvPath);
    seen.add(projectEnvPath);
  }

  const defaults = [
    path.join(projectsRoot, ".orch", "env", "global.env"),
    path.join(projectsRoot, "secrets", "global.env"),
  ];

  for (const candidate of defaults) {
    if (!seen.has(candidate)) {
      candidates.push(candidate);
      seen.add(candidate);
    }
  }

  return candidates;
};

const resolveGhEnvironment = (repoRoot, log) => {
  const env = { ...process.env };
  const candidates = getGithubEnvFileCandidates(repoRoot, log);

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) {
      continue;
    }
    const resolved = findGithubTokenInEnvText(fs.readFileSync(envPath, "utf8"));
    if (resolved !== null) {
      log(`Using ${resolved.key} from ${envPath} for GitHub CLI auth`);
      env.GH_TOKEN = resolved.token;
      env.GITHUB_TOKEN = resolved.token;
      return env;
    }
  }

  const fromProcess = GITHUB_ENV_KEYS.find((key) => {
    const value = process.env[key]?.trim() ?? "";
    return value.length > 0;
  });

  if (fromProcess) {
    log(`Using ${fromProcess} from current process environment for GitHub CLI auth`);
  } else {
    log("No GitHub token found in docker-git env files or current process");
  }

  return env;
};

const ghCommand = (args, ghEnv, inputFilePath = null) => {
  const resolvedArgs = inputFilePath ? [...args, "--input", inputFilePath] : args;
  const result = spawnSync("gh", resolvedArgs, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: ghEnv,
  });

  return {
    success: result.status === 0,
    status: result.status ?? 1,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
};

const ghApi = (endpoint, ghEnv, options = {}) => {
  const args = ["api", endpoint];
  if (options.method && options.method !== "GET") {
    args.push("-X", options.method);
  }
  if (options.jq) {
    args.push("--jq", options.jq);
  }
  if (options.rawFields) {
    for (const [key, value] of Object.entries(options.rawFields)) {
      args.push("-f", `${key}=${value}`);
    }
  }

  let inputFilePath = null;
  if (options.body !== undefined) {
    inputFilePath = path.join(os.tmpdir(), `docker-git-gh-api-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    fs.writeFileSync(inputFilePath, JSON.stringify(options.body), "utf8");
  }

  try {
    return ghCommand(args, ghEnv, inputFilePath);
  } finally {
    if (inputFilePath !== null) {
      fs.rmSync(inputFilePath, { force: true });
    }
  }
};

const ghApiJson = (endpoint, ghEnv, options = {}) => {
  const result = ghApi(endpoint, ghEnv, options);
  if (!result.success) {
    return { ...result, json: null };
  }

  try {
    return { ...result, json: JSON.parse(result.stdout) };
  } catch {
    return { ...result, json: null };
  }
};

const ensureSuccess = (result, context) => {
  if (!result.success) {
    throw new Error(`${context}: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  return result;
};

const resolveViewerLogin = (ghEnv) =>
  ensureSuccess(
    ghApi("/user", ghEnv, { jq: ".login" }),
    "failed to resolve authenticated GitHub login"
  ).stdout;

const buildBlobUrl = (repoFullName, branch, repoPath) =>
  `https://github.com/${repoFullName}/blob/${encodeURIComponent(branch)}/${
    repoPath.split("/").map((segment) => encodeURIComponent(segment)).join("/")
  }`;

const toSnapshotStamp = (createdAt) =>
  createdAt.replaceAll(":", "-").replaceAll(".", "-");

const getRepoInfo = (repoFullName, ghEnv) =>
  ghApiJson(`/repos/${repoFullName}`, ghEnv);

const ensureBackupRepo = (ghEnv, log, createIfMissing = true) => {
  const login = resolveViewerLogin(ghEnv);
  const repoFullName = `${login}/${BACKUP_REPO_NAME}`;
  let repoResult = getRepoInfo(repoFullName, ghEnv);

  if (!repoResult.success && createIfMissing) {
    log(`Creating private session backup repository for ${login}...`);
    repoResult = ghApiJson("/user/repos", ghEnv, {
      method: "POST",
      body: {
        name: BACKUP_REPO_NAME,
        private: true,
        auto_init: true,
        description: "docker-git session backups",
      },
    });
  }

  if (!repoResult.success || repoResult.json === null) {
    return null;
  }

  const defaultBranch = repoResult.json.default_branch || BACKUP_DEFAULT_BRANCH;
  return {
    owner: login,
    repo: BACKUP_REPO_NAME,
    fullName: repoFullName,
    defaultBranch,
    htmlUrl: repoResult.json.html_url,
  };
};

const getBranchHeadSha = (repoFullName, branch, ghEnv) =>
  ensureSuccess(
    ghApi(`/repos/${repoFullName}/git/ref/heads/${branch}`, ghEnv, { jq: ".object.sha" }),
    `failed to resolve ${repoFullName}@${branch} ref`
  ).stdout;

const getCommitTreeSha = (repoFullName, commitSha, ghEnv) =>
  ensureSuccess(
    ghApi(`/repos/${repoFullName}/git/commits/${commitSha}`, ghEnv, { jq: ".tree.sha" }),
    `failed to resolve tree for commit ${commitSha}`
  ).stdout;

const createBlob = (repoFullName, contentBase64, ghEnv) =>
  ensureSuccess(
    ghApi(`/repos/${repoFullName}/git/blobs`, ghEnv, {
      method: "POST",
      body: {
        content: contentBase64,
        encoding: "base64",
      },
      jq: ".sha",
    }),
    `failed to create blob in ${repoFullName}`
  ).stdout;

const createTree = (repoFullName, baseTreeSha, treeEntries, ghEnv) =>
  ensureSuccess(
    ghApi(`/repos/${repoFullName}/git/trees`, ghEnv, {
      method: "POST",
      body: {
        base_tree: baseTreeSha,
        tree: treeEntries,
      },
      jq: ".sha",
    }),
    `failed to create tree in ${repoFullName}`
  ).stdout;

const createCommit = (repoFullName, message, treeSha, parentSha, ghEnv) =>
  ensureSuccess(
    ghApi(`/repos/${repoFullName}/git/commits`, ghEnv, {
      method: "POST",
      body: {
        message,
        tree: treeSha,
        parents: [parentSha],
      },
      jq: ".sha",
    }),
    `failed to create commit in ${repoFullName}`
  ).stdout;

const updateBranchRef = (repoFullName, branch, commitSha, ghEnv) =>
  ensureSuccess(
    ghApi(`/repos/${repoFullName}/git/refs/heads/${branch}`, ghEnv, {
      method: "PATCH",
      rawFields: { sha: commitSha },
      jq: ".object.sha",
    }),
    `failed to update ${repoFullName}@${branch}`
  ).stdout;

const getTreeEntries = (repoFullName, branch, ghEnv) => {
  const headSha = getBranchHeadSha(repoFullName, branch, ghEnv);
  const treeSha = getCommitTreeSha(repoFullName, headSha, ghEnv);
  const result = ensureSuccess(
    ghApiJson(`/repos/${repoFullName}/git/trees/${treeSha}?recursive=1`, ghEnv),
    `failed to list tree for ${repoFullName}@${branch}`
  );
  return {
    headSha,
    treeSha,
    entries: Array.isArray(result.json?.tree) ? result.json.tree : [],
  };
};

const getFileContent = (repoFullName, repoPath, ghEnv, ref = BACKUP_DEFAULT_BRANCH) => {
  const result = ensureSuccess(
    ghApiJson(`/repos/${repoFullName}/contents/${repoPath}?ref=${encodeURIComponent(ref)}`, ghEnv),
    `failed to fetch ${repoFullName}:${repoPath}`
  );
  const encoding = result.json?.encoding;
  const content = typeof result.json?.content === "string" ? result.json.content.replace(/\n/g, "") : "";
  if (encoding !== "base64" || content.length === 0) {
    throw new Error(`unexpected content payload for ${repoFullName}:${repoPath}`);
  }
  return Buffer.from(content, "base64");
};

const buildSnapshotRef = (sourceRepo, prNumber, commitSha, createdAt) =>
  `${sourceRepo}/pr-${prNumber === null ? "no-pr" : prNumber}/commit-${commitSha}/${toSnapshotStamp(createdAt)}`;

const buildCommitMessage = ({ sourceRepo, branch, commitSha, createdAt }) =>
  `session-backup: ${sourceRepo} ${branch} ${commitSha.slice(0, 12)} ${toSnapshotStamp(createdAt)}`;

const buildChunkManifest = (logicalName, originalSize, partNames) => ({
  original: logicalName,
  originalSize,
  parts: partNames,
  splitAt: MAX_REPO_FILE_SIZE,
  partsCount: partNames.length,
  createdAt: new Date().toISOString(),
});

const splitLargeFile = (sourcePath, logicalName, outputDir) => {
  const totalSize = fs.statSync(sourcePath).size;
  const partNames = [];
  const fd = fs.openSync(sourcePath, "r");
  const buffer = Buffer.alloc(1024 * 1024);
  let offset = 0;
  let remaining = totalSize;
  let partIndex = 1;
  let partBytesWritten = 0;
  let partName = `${logicalName}.part${partIndex}`;
  let partPath = path.join(outputDir, partName);
  let partFd = fs.openSync(partPath, "w");
  partNames.push(partName);

  try {
    while (remaining > 0) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, offset);
      if (bytesRead === 0) {
        break;
      }

      let chunkOffset = 0;
      while (chunkOffset < bytesRead) {
        if (partBytesWritten >= MAX_REPO_FILE_SIZE) {
          fs.closeSync(partFd);
          partIndex += 1;
          partBytesWritten = 0;
          partName = `${logicalName}.part${partIndex}`;
          partPath = path.join(outputDir, partName);
          partFd = fs.openSync(partPath, "w");
          partNames.push(partName);
        }

        const remainingChunk = bytesRead - chunkOffset;
        const remainingPart = MAX_REPO_FILE_SIZE - partBytesWritten;
        const toWrite = Math.min(remainingChunk, remainingPart);
        fs.writeSync(partFd, buffer.subarray(chunkOffset, chunkOffset + toWrite));
        partBytesWritten += toWrite;
        chunkOffset += toWrite;
      }

      offset += bytesRead;
      remaining -= bytesRead;
    }
  } finally {
    fs.closeSync(fd);
    fs.closeSync(partFd);
  }

  return {
    originalSize: totalSize,
    partNames,
    manifestName: `${logicalName}${CHUNK_MANIFEST_SUFFIX}`,
  };
};

const prepareUploadArtifacts = (sessionFiles, snapshotRef, repoFullName, branch, tmpDir, log) => {
  const uploadEntries = [];
  const manifestFiles = [];

  for (const file of sessionFiles) {
    if (file.size <= MAX_REPO_FILE_SIZE) {
      const repoPath = `${snapshotRef}/${file.logicalName}`;
      uploadEntries.push({
        repoPath,
        sourcePath: file.sourcePath,
        type: "file",
        size: file.size,
      });
      manifestFiles.push({
        type: "file",
        name: file.logicalName,
        size: file.size,
        repoPath,
        url: buildBlobUrl(repoFullName, branch, repoPath),
      });
      continue;
    }

    log(`Splitting oversized file ${file.logicalName} (${file.size} bytes)`);
    const split = splitLargeFile(file.sourcePath, file.logicalName, tmpDir);
    const chunkManifest = buildChunkManifest(file.logicalName, split.originalSize, split.partNames);
    const chunkManifestPath = path.join(tmpDir, split.manifestName);
    fs.writeFileSync(chunkManifestPath, `${JSON.stringify(chunkManifest, null, 2)}\n`, "utf8");

    const partEntries = split.partNames.map((partName) => {
      const repoPath = `${snapshotRef}/${partName}`;
      uploadEntries.push({
        repoPath,
        sourcePath: path.join(tmpDir, partName),
        type: "chunk-part",
        size: fs.statSync(path.join(tmpDir, partName)).size,
      });
      return {
        name: partName,
        repoPath,
        url: buildBlobUrl(repoFullName, branch, repoPath),
      };
    });

    const chunkManifestRepoPath = `${snapshotRef}/${split.manifestName}`;
    uploadEntries.push({
      repoPath: chunkManifestRepoPath,
      sourcePath: chunkManifestPath,
      type: "chunk-manifest",
      size: fs.statSync(chunkManifestPath).size,
    });

    manifestFiles.push({
      type: "chunked",
      name: file.logicalName,
      originalSize: split.originalSize,
      chunkManifestPath: chunkManifestRepoPath,
      chunkManifestUrl: buildBlobUrl(repoFullName, branch, chunkManifestRepoPath),
      parts: partEntries,
    });
  }

  return { uploadEntries, manifestFiles };
};

const readFileAsBase64 = (filePath) => fs.readFileSync(filePath).toString("base64");

const uploadSnapshot = (backupRepo, snapshotRef, snapshotManifest, uploadEntries, ghEnv) => {
  const headSha = getBranchHeadSha(backupRepo.fullName, backupRepo.defaultBranch, ghEnv);
  const baseTreeSha = getCommitTreeSha(backupRepo.fullName, headSha, ghEnv);
  const treeEntries = [];

  for (const entry of uploadEntries) {
    const blobSha = createBlob(backupRepo.fullName, readFileAsBase64(entry.sourcePath), ghEnv);
    treeEntries.push({
      path: entry.repoPath,
      mode: "100644",
      type: "blob",
      sha: blobSha,
    });
  }

  const manifestPath = `${snapshotRef}/manifest.json`;
  const manifestBlobSha = createBlob(
    backupRepo.fullName,
    Buffer.from(`${JSON.stringify(snapshotManifest, null, 2)}\n`, "utf8").toString("base64"),
    ghEnv
  );
  treeEntries.push({
    path: manifestPath,
    mode: "100644",
    type: "blob",
    sha: manifestBlobSha,
  });

  const nextTreeSha = createTree(backupRepo.fullName, baseTreeSha, treeEntries, ghEnv);
  const nextCommitSha = createCommit(
    backupRepo.fullName,
    buildCommitMessage(snapshotManifest.source),
    nextTreeSha,
    headSha,
    ghEnv
  );
  updateBranchRef(backupRepo.fullName, backupRepo.defaultBranch, nextCommitSha, ghEnv);

  return {
    commitSha: nextCommitSha,
    manifestPath,
    manifestUrl: buildBlobUrl(backupRepo.fullName, backupRepo.defaultBranch, manifestPath),
  };
};

const sanitizeSnapshotRefForOutput = (snapshotRef) =>
  snapshotRef.replace(/[\\/]/g, "_");

const decodeChunkManifestBuffer = (buffer, sourcePath) => {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    throw new Error(`failed to parse chunk manifest ${sourcePath}: ${error.message}`);
  }
};

module.exports = {
  BACKUP_DEFAULT_BRANCH,
  BACKUP_REPO_NAME,
  CHUNK_MANIFEST_SUFFIX,
  MAX_REPO_FILE_SIZE,
  buildBlobUrl,
  buildSnapshotRef,
  decodeChunkManifestBuffer,
  ensureBackupRepo,
  getFileContent,
  getTreeEntries,
  parseEnvText,
  prepareUploadArtifacts,
  resolveGhEnvironment,
  sanitizeSnapshotRefForOutput,
  uploadSnapshot,
};
