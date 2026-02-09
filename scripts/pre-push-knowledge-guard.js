#!/usr/bin/env node

// CHANGE: Prevent pushing commits that contain oversized blobs under .knowledge/.knowlenge.
// WHY: GitHub rejects blobs >= 100MB; we enforce < 99MB deterministically before pushing.
// QUOTE(ТЗ): "сделать что бы он делил файлы до того момента пока они не станут весить меньше 99 мб?"
// REF: chat-2026-02-09
// SOURCE: n/a
// FORMAT THEOREM: ∀b ∈ Blobs(pushedRange): size(b) ≤ MAX_BYTES → pushAllowed
// PURITY: SHELL (git IO)
// INVARIANT: No pushed blob exceeds MAX_BYTES.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

const MAX_BYTES = 99 * 1000 * 1000;
const PATHS = [".knowledge", ".knowlenge"];

const isZeroSha = (sha) => /^0+$/.test(sha);

const sh = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", ...options });

const toMb = (bytes) => (bytes / 1_000_000).toFixed(2);

const stdin = fs.readFileSync(0, "utf8").trimEnd();
if (stdin.length === 0) process.exit(0);

const lines = stdin
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l.length > 0);

/** @type {ReadonlyArray<string>} */
const ranges = lines.flatMap((line) => {
  const parts = line.split(/\s+/);
  if (parts.length < 4) return [];
  const [, localSha, , remoteSha] = parts;

  // Deletion or unknown state; nothing to validate.
  if (!localSha || isZeroSha(localSha)) return [];

  // New remote ref: remote sha is 000..0. Check all history reachable from localSha.
  if (!remoteSha || isZeroSha(remoteSha)) return [localSha];

  return [`${remoteSha}..${localSha}`];
});

const oversize = [];

for (const range of ranges) {
  let revList = "";
  try {
    revList = sh("git", ["rev-list", "--objects", range, "--", ...PATHS]);
  } catch {
    // If the range is invalid, let git push handle the error.
    continue;
  }

  const objectToPath = new Map();
  for (const line of revList.split("\n")) {
    if (!line) continue;
    const space = line.indexOf(" ");
    if (space === -1) continue; // commit/tag objects
    const oid = line.slice(0, space);
    const filePath = line.slice(space + 1);
    if (!objectToPath.has(oid)) objectToPath.set(oid, filePath);
  }

  const oids = [...objectToPath.keys()];
  if (oids.length === 0) continue;

  const batch = sh(
    "git",
    ["cat-file", `--batch-check=%(objecttype) %(objectname) %(objectsize)`],
    { input: `${oids.join("\n")}\n` }
  );

  for (const row of batch.split("\n")) {
    if (!row) continue;
    const [type, oid, sizeRaw] = row.split(" ");
    if (type !== "blob") continue;
    const size = Number(sizeRaw);
    if (!Number.isFinite(size)) continue;
    if (size > MAX_BYTES) {
      oversize.push({
        oid,
        size,
        path: objectToPath.get(oid) ?? "(unknown path)",
        range,
      });
    }
  }
}

if (oversize.length === 0) process.exit(0);

console.error(
  `ERROR: Push blocked. Found blobs > ${MAX_BYTES} bytes (${toMb(
    MAX_BYTES
  )} MB) under ${PATHS.join(", ")}.`
);
for (const item of oversize) {
  console.error(
    ` - ${item.path}: ${item.size} bytes (${toMb(item.size)} MB) [${item.oid}]`
  );
}

console.error("");
console.error("Fix options:");
console.error(" - If the large files are not committed yet: just commit again (pre-commit will split them).");
console.error(" - If the large files are already committed (most common):");
console.error("   1) node scripts/split-knowledge-large-files.js");
console.error("   2) node scripts/repair-knowledge-history.js");
console.error("   3) git push");
console.error("");
console.error("To bypass this guard (not recommended): set DOCKER_GIT_SKIP_KNOWLEDGE_GUARD=1");

process.exit(1);
