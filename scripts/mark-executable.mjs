#!/usr/bin/env bun

import { chmodSync } from "node:fs"
import { resolve } from "node:path"

// CHANGE: centralize executable-bit handling for generated CLI files.
// WHY: POSIX chmod is not available on Windows, while Linux/macOS package builds require executable bins.
// QUOTE(TZ): "run conveniently on Windows and Linux"
// REF: issue-278
// SOURCE: n/a
// FORMAT THEOREM: forall p in Paths: platform=win32 -> no_posix_chmod(p), platform!=win32 -> executable(p)
// PURITY: SHELL
// EFFECT: filesystem metadata update
// INVARIANT: missing target argument exits non-zero; Windows builds do not invoke POSIX chmod.
// COMPLEXITY: O(1)/O(1)
const target = process.argv[2]

if (target === undefined || target.length === 0) {
  process.stderr.write("Usage: mark-executable <path>\n")
  process.exitCode = 1
} else if (process.platform !== "win32") {
  chmodSync(resolve(process.cwd(), target), 0o755)
}
