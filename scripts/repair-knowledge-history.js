#!/usr/bin/env node

// CHANGE: Rewrite unpushed commits so oversized .knowledge/.knowlenge files are split inside history.
// WHY: Splitting in the working tree is not enough once a >100MB blob is committed; the blob must become unreachable.
// QUOTE(ТЗ): "почему прехук опять не отработал? ... делил файлы ... меньше 99 мб"
// REF: chat-2026-02-09
// SOURCE: n/a
// FORMAT THEOREM: upstream..HEAD rewritten s.t. ∀b ∈ Blobs(upstream..HEAD): size(b) ≤ MAX_BYTES
// PURITY: SHELL (git IO)

const { execFileSync } = require("node:child_process");

const MAX_BYTES = 99 * 1000 * 1000;

const sh = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", ...options }).trim();

const trySh = (cmd, args, options = {}) => {
  try {
    return sh(cmd, args, options);
  } catch {
    return null;
  }
};

const status = sh("git", ["status", "--porcelain"]);
if (status.length !== 0) {
  console.error("ERROR: Working tree is not clean. Commit/stash changes and retry.");
  process.exit(1);
}

const upstreamSha =
  trySh("git", ["rev-parse", "--verify", "@{u}"]) ??
  (() => {
    const branch = trySh("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (!branch) return null;
    return trySh("git", ["rev-parse", "--verify", `origin/${branch}`]);
  })();

if (!upstreamSha) {
  console.error(
    "ERROR: No upstream configured for this branch. Set upstream (git branch --set-upstream-to=origin/<branch>) and retry."
  );
  process.exit(1);
}

const countRaw = sh("git", ["rev-list", "--count", `${upstreamSha}..HEAD`]);
const count = Number(countRaw);
if (!Number.isFinite(count) || count <= 0) {
  console.log("No unpushed commits to rewrite (upstream..HEAD is empty).");
  process.exit(0);
}

// Run splitter after each commit is replayed, and amend only if it produced changes.
const execCmd = [
  `node scripts/split-knowledge-large-files.js`,
  `if [ -d .knowledge ]; then git add -A .knowledge; fi`,
  `if [ -d .knowlenge ]; then git add -A .knowlenge; fi`,
  `if ! git diff --cached --quiet; then git commit --amend --no-edit --no-verify; fi`,
].join(" && ");

console.log(
  `Rewriting ${count} commit(s) (upstream..HEAD) to enforce <${MAX_BYTES} bytes per .knowledge blob...`
);

try {
  execFileSync("git", ["rebase", upstreamSha, "--exec", execCmd], {
    stdio: "inherit",
  });
} catch {
  console.error("");
  console.error("ERROR: Rebase failed. Resolve conflicts, then run:");
  console.error(" - git rebase --continue");
  console.error("Or abort:");
  console.error(" - git rebase --abort");
  process.exit(1);
}

console.log("Done. You can now run: git push");
