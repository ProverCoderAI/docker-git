#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const MAX_BYTES = 99 * 1000 * 1000;
const KNOWLEDGE_DIR_NAMES = new Set([".knowledge", ".knowlenge"]);
const WALK_IGNORE_DIR_NAMES = new Set([".git", "node_modules"]);
const MANIFEST_SUFFIX = ".chunks.json";
const CHUNK_BYTES = 1024 * 1024;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isPartFile = (fileName) => /\.part\d+$/.test(fileName);

const isManifest = (fileName) => fileName.endsWith(MANIFEST_SUFFIX);

const getPartRegex = (baseName) =>
  new RegExp(`^${escapeRegExp(baseName)}\\.part\\d+$`);

const findKnowledgeRoots = (startDir) => {
  const result = [];

  const visit = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (WALK_IGNORE_DIR_NAMES.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      if (KNOWLEDGE_DIR_NAMES.has(entry.name)) {
        result.push(fullPath);
        continue;
      }

      visit(fullPath);
    }
  };

  visit(startDir);
  return result;
};

const removeSplitArtifacts = (filePath) => {
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath);
  const entries = fs.readdirSync(dir);
  const partRegex = getPartRegex(baseName);

  for (const entry of entries) {
    if (!partRegex.test(entry)) continue;
    fs.rmSync(path.join(dir, entry));
  }

  const manifestPath = `${filePath}${MANIFEST_SUFFIX}`;
  if (fs.existsSync(manifestPath)) {
    fs.rmSync(manifestPath);
  }
};

const walk = (dir) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!entry.isFile()) continue;
    if (isPartFile(entry.name) || isManifest(entry.name)) continue;
    splitIfLarge(fullPath);
  }
};

const splitIfLarge = (filePath) => {
  const stats = fs.statSync(filePath);
  if (stats.size <= MAX_BYTES) {
    removeSplitArtifacts(filePath);
    return;
  }

  removeSplitArtifacts(filePath);

  const totalSize = stats.size;
  const partsCount = Math.ceil(totalSize / MAX_BYTES);
  const partPaths = [];

  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(CHUNK_BYTES);
  let offset = 0;
  let remaining = totalSize;
  let partIndex = 1;
  let partBytesWritten = 0;
  let partPath = `${filePath}.part${partIndex}`;
  let partFd = fs.openSync(partPath, "w");
  partPaths.push(path.basename(partPath));

  while (remaining > 0) {
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, offset);
    if (bytesRead === 0) break;

    let chunkOffset = 0;
    while (chunkOffset < bytesRead) {
      if (partBytesWritten >= MAX_BYTES) {
        fs.closeSync(partFd);
        partIndex += 1;
        partBytesWritten = 0;
        partPath = `${filePath}.part${partIndex}`;
        partFd = fs.openSync(partPath, "w");
        partPaths.push(path.basename(partPath));
      }

      const remainingChunk = bytesRead - chunkOffset;
      const remainingPart = MAX_BYTES - partBytesWritten;
      const toWrite = Math.min(remainingChunk, remainingPart);
      fs.writeSync(partFd, buffer.subarray(chunkOffset, chunkOffset + toWrite));
      partBytesWritten += toWrite;
      chunkOffset += toWrite;
    }

    offset += bytesRead;
    remaining -= bytesRead;
  }

  fs.closeSync(fd);
  fs.closeSync(partFd);

  const manifest = {
    original: filePath,
    originalSize: totalSize,
    parts: partPaths,
    splitAt: MAX_BYTES,
    partsCount,
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    `${filePath}${MANIFEST_SUFFIX}`,
    JSON.stringify(manifest, null, 2)
  );
  fs.rmSync(filePath);

  console.log(`[knowledge-split] Split ${filePath} -> ${partsCount} part(s)`);
};

const ROOTS = findKnowledgeRoots(process.cwd());

for (const root of ROOTS) {
  walk(root);
}
