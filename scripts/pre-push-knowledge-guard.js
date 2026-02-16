#!/usr/bin/env node

// CHANGE: Prevent pushing commits that contain oversized blobs or secret-like data under any .knowledge/.knowlenge path.
// WHY: keep repository history safe (size + credentials) before refs leave local machine.
// QUOTE(ТЗ): "сделать что бы он делил файлы до того момента пока они не станут весить меньше 99 мб?"
// REF: chat-2026-02-09
// SOURCE: n/a
// FORMAT THEOREM: ∀b ∈ Blobs(pushedRange, knowledgePaths): size(b) ≤ MAX_BYTES ∧ noSecrets(b) → pushAllowed
// PURITY: SHELL (git IO)
// INVARIANT: No pushed blob in knowledge paths exceeds MAX_BYTES or matches secret patterns (regex + optional gitleaks).

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

const MAX_BYTES = 99 * 1000 * 1000;
const KNOWLEDGE_DIR_NAMES = new Set([".knowledge", ".knowlenge"]);
const SECRET_PATTERNS = [
  {
    name: "GitHub token",
    regex: /\b(?:github_pat_|gho_|ghp_|ghu_|ghs_|ghr_|gha_)[A-Za-z0-9_]{20,255}\b/,
  },
  {
    name: "Anthropic key",
    regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
  },
  {
    name: "OpenAI key",
    regex: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  },
  {
    name: "Private key block",
    regex: /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/,
  },
];

const isZeroSha = (sha) => /^0+$/.test(sha);
const isKnowledgePath = (filePath) =>
  filePath.split("/").some((segment) => KNOWLEDGE_DIR_NAMES.has(segment));
const toPathsList = (paths) => [...paths.values()].sort();
const firstPath = (paths) => toPathsList(paths)[0] ?? "(unknown path)";

const sh = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", ...options });

const shBytes = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { encoding: null, ...options });

const hasGitleaks = (() => {
  try {
    execFileSync("gitleaks", ["version"], {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
})();

const toMb = (bytes) => (bytes / 1_000_000).toFixed(2);
const classifySecret = (text) => {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.regex.test(text)) return pattern.name;
  }
  return null;
};
const scanWithGitleaks = (content) => {
  if (!hasGitleaks) return "skip";
  try {
    execFileSync(
      "gitleaks",
      ["stdin", "--no-banner", "--redact", "--log-level", "error"],
      {
        encoding: null,
        stdio: ["pipe", "ignore", "ignore"],
        input: content,
      }
    );
    return "clean";
  } catch (error) {
    const status = typeof error?.status === "number" ? error.status : null;
    if (status === 1) return "hit";
    return "error";
  }
};

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
const secretHits = [];
const objectToPaths = new Map();
const oversizeBlobOids = new Set();
let gitleaksErrorCount = 0;

for (const range of ranges) {
  let revList = "";
  try {
    revList = sh("git", ["rev-list", "--objects", range]);
  } catch {
    // If the range is invalid, let git push handle the error.
    continue;
  }

  for (const line of revList.split("\n")) {
    if (!line) continue;
    const space = line.indexOf(" ");
    if (space === -1) continue; // commit/tag objects
    const oid = line.slice(0, space);
    const filePath = line.slice(space + 1);
    if (!isKnowledgePath(filePath)) continue;
    const paths = objectToPaths.get(oid) ?? new Set();
    paths.add(filePath);
    objectToPaths.set(oid, paths);
  }
}

const oids = [...objectToPaths.keys()];
if (oids.length === 0) process.exit(0);

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
      paths: objectToPaths.get(oid) ?? new Set(),
    });
    oversizeBlobOids.add(oid);
  }
}

for (const oid of oids) {
  if (oversizeBlobOids.has(oid)) continue;
  let content;
  try {
    content = shBytes("git", ["cat-file", "-p", oid], { maxBuffer: MAX_BYTES + 1_000_000 });
  } catch {
    continue;
  }
  if (content.includes(0)) continue;

  const text = content.toString("utf8");
  const secretType = classifySecret(text);
  if (secretType !== null) {
    secretHits.push({
      oid,
      paths: objectToPaths.get(oid) ?? new Set(),
      type: secretType,
    });
    continue;
  }

  const gitleaksState = scanWithGitleaks(content);
  if (gitleaksState === "hit") {
    secretHits.push({
      oid,
      paths: objectToPaths.get(oid) ?? new Set(),
      type: "Gitleaks finding",
    });
    continue;
  }
  if (gitleaksState === "error") {
    gitleaksErrorCount += 1;
  }
}

if (oversize.length === 0 && secretHits.length === 0) process.exit(0);

if (oversize.length > 0) {
  console.error(
    `ERROR: Push blocked. Found blobs > ${MAX_BYTES} bytes (${toMb(MAX_BYTES)} MB) under .knowledge/.knowlenge paths.`
  );
  for (const item of oversize) {
    console.error(
      ` - ${firstPath(item.paths)}: ${item.size} bytes (${toMb(item.size)} MB) [${item.oid}]`
    );
  }
}

if (secretHits.length > 0) {
  console.error("ERROR: Push blocked. Found secret-like content under .knowledge/.knowlenge paths.");
  for (const item of secretHits) {
    console.error(
      ` - ${firstPath(item.paths)}: ${item.type} [${item.oid}]`
    );
  }
}

if (gitleaksErrorCount > 0) {
  console.error(
    `WARN: gitleaks scanner errored for ${gitleaksErrorCount} blob(s); fallback regex checks were used.`
  );
}

console.error("");
console.error("Fix options:");
console.error(" - For new changes: commit again (pre-commit will split + redact knowledge files).");
console.error(" - For already committed changes in upstream..HEAD:");
console.error("   1) node scripts/split-knowledge-large-files.js");
console.error("   2) bash scripts/pre-commit-secret-guard.sh");
console.error("   3) node scripts/repair-knowledge-history.js");
console.error("   4) git push");
console.error("");
console.error("To bypass this guard (not recommended): set DOCKER_GIT_SKIP_KNOWLEDGE_GUARD=1");

process.exit(1);
