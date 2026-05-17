#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const rootDir = join(scriptDir, "..")
const skillerDir = join(rootDir, "third_party", "skiller-desktop-skills-manager")
const patchFiles = [
  join(rootDir, "patches", "skiller", "docker-git-browser-folder-picker.patch")
]

const parseRange = (value) => {
  const [start = "0", count = "1"] = value.split(",")
  return {
    count: Number.parseInt(count, 10),
    start: Number.parseInt(start, 10)
  }
}

const parsePatch = (patchText) => {
  const lines = patchText.split(/\r?\n/u)
  const files = []
  let index = 0
  while (index < lines.length) {
    const diffLine = lines[index] ?? ""
    if (!diffLine.startsWith("diff --git ")) {
      index += 1
      continue
    }
    const match = /^diff --git a\/(.+) b\/(.+)$/u.exec(diffLine)
    if (match === null) {
      throw new Error(`Unsupported patch header: ${diffLine}`)
    }
    const file = { path: match[2] ?? match[1] ?? "", hunks: [] }
    index += 1
    while (index < lines.length && !(lines[index] ?? "").startsWith("diff --git ")) {
      const hunkLine = lines[index] ?? ""
      const hunkMatch = /^@@ -([^ ]+) \+([^ ]+) @@/u.exec(hunkLine)
      if (hunkMatch === null) {
        index += 1
        continue
      }
      const oldRange = parseRange(hunkMatch[1] ?? "0")
      const newRange = parseRange(hunkMatch[2] ?? "0")
      const hunk = { lines: [], newStart: newRange.start, oldStart: oldRange.start }
      index += 1
      while (index < lines.length) {
        const line = lines[index] ?? ""
        if (line.startsWith("diff --git ") || line.startsWith("@@ ")) {
          break
        }
        if (line.startsWith("\\ No newline")) {
          index += 1
          continue
        }
        const kind = line[0]
        if (kind !== " " && kind !== "+" && kind !== "-") {
          break
        }
        hunk.lines.push({ kind, text: line.slice(1) })
        index += 1
      }
      file.hunks.push(hunk)
    }
    files.push(file)
  }
  return files
}

// CHANGE: normalize checkout-dependent CRLF before exact hunk matching
// WHY: Windows submodule checkouts can contain CRLF while docker-git patch files are LF-based
// SOURCE: n/a
// INVARIANT: patch matching depends on line content, not host checkout end-of-line policy
const splitText = (text) => {
  const normalized = text.replace(/\r\n/gu, "\n")
  return {
    finalNewline: normalized.endsWith("\n"),
    lines: normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n")
  }
}

const joinText = ({ finalNewline, lines }) =>
  `${lines.join("\n")}${finalNewline ? "\n" : ""}`

const hunkLines = (hunk, direction, side) =>
  hunk.lines
    .filter(({ kind }) =>
      kind === " " || (direction === "forward"
        ? side === "from" ? kind === "-" : kind === "+"
        : side === "from" ? kind === "+" : kind === "-"))
    .map(({ text }) => text)

const applyFilePatch = (content, filePatch, direction) => {
  const parsed = splitText(content)
  const lines = [...parsed.lines]
  let offset = 0
  for (const hunk of filePatch.hunks) {
    const fromLines = hunkLines(hunk, direction, "from")
    const toLines = hunkLines(hunk, direction, "to")
    const rangeStart = direction === "forward" ? hunk.oldStart : hunk.newStart
    const start = (fromLines.length === 0 ? rangeStart : rangeStart - 1) + offset
    const current = lines.slice(start, start + fromLines.length)
    if (current.length !== fromLines.length || current.some((line, itemIndex) => line !== fromLines[itemIndex])) {
      return null
    }
    lines.splice(start, fromLines.length, ...toLines)
    offset += toLines.length - fromLines.length
  }
  return joinText({ finalNewline: parsed.finalNewline, lines })
}

const applyPatchSet = (patches, direction, write) => {
  const nextFiles = []
  for (const filePatch of patches) {
    const filePath = join(skillerDir, filePatch.path)
    if (!existsSync(filePath)) {
      return false
    }
    const current = readFileSync(filePath, "utf8")
    const next = applyFilePatch(current, filePatch, direction)
    if (next === null) {
      return false
    }
    nextFiles.push({ filePath, next })
  }
  if (write) {
    for (const { filePath, next } of nextFiles) {
      writeFileSync(filePath, next)
    }
  }
  return true
}

if (!existsSync(join(skillerDir, "package.json"))) {
  console.error(`Skiller submodule is not initialized at ${skillerDir}.`)
  process.exit(1)
}

for (const patchFile of patchFiles) {
  if (!existsSync(patchFile)) {
    console.error(`Skiller docker-git patch is missing: ${patchFile}`)
    process.exit(1)
  }
  const patches = parsePatch(readFileSync(patchFile, "utf8"))
  if (applyPatchSet(patches, "forward", false)) {
    applyPatchSet(patches, "forward", true)
    console.log(`Applied Skiller docker-git patch: ${patchFile}`)
    continue
  }
  if (applyPatchSet(patches, "reverse", false)) {
    console.log(`Skiller docker-git patch already applied: ${patchFile}`)
    continue
  }
  console.error(`Skiller docker-git patch does not match submodule contents: ${patchFile}`)
  process.exit(1)
}
