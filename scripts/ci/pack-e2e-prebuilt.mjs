#!/usr/bin/env bun
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { relative, resolve, sep } from "node:path"
import { spawnSync } from "node:child_process"

const outputPath = process.argv[2] ?? "artifacts/docker-git-e2e-prebuilt.tgz"
const repoRoot = process.cwd()
const outputAbsolutePath = resolve(repoRoot, outputPath)
const paths = new Set()
const queue = []
const scanned = new Set()

const toRelativePath = (path) => {
  const relativePath = relative(repoRoot, path)
  return relativePath.length === 0 ? "." : relativePath
}

const fail = (message) => {
  console.error(message)
  process.exit(1)
}

const addExistingPath = (path) => {
  if (!existsSync(path)) {
    fail(`Missing E2E artifact path: ${path}`)
  }

  const relativePath = toRelativePath(resolve(repoRoot, path))
  if (!paths.has(relativePath)) {
    paths.add(relativePath)
    queue.push(relativePath)
  }
}

const nearestNodeModulesDir = (absolutePath) => {
  const parts = absolutePath.split(sep)
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index] === "node_modules") {
      return parts.slice(0, index + 1).join(sep)
    }
  }
  return null
}

const addModulePath = (path) => {
  addExistingPath(path)

  const realPath = realpathSync(path)
  addExistingPath(realPath)

  const nodeModulesDir = nearestNodeModulesDir(realPath)
  if (nodeModulesDir !== null) {
    addExistingPath(nodeModulesDir)
  }
}

const scanSymlinks = (relativePath) => {
  const absolutePath = resolve(repoRoot, relativePath)
  const stat = lstatSync(absolutePath)

  if (stat.isSymbolicLink()) {
    addModulePath(absolutePath)
    return
  }
  if (!stat.isDirectory()) {
    return
  }

  const realDirectoryPath = realpathSync(absolutePath)
  if (scanned.has(realDirectoryPath)) {
    return
  }
  scanned.add(realDirectoryPath)

  for (const entry of readdirSync(absolutePath)) {
    scanSymlinks(relative(repoRoot, resolve(absolutePath, entry)))
  }
}

const packageJson = JSON.parse(readFileSync("packages/app/package.json", "utf8"))
const runtimeDependencies = Object.keys(packageJson.dependencies ?? {})
const extraRuntimePackages = ["ws"]

for (const path of [
  "packages/app/dist",
  "packages/app/dist-web",
  "packages/app/package.json",
  "packages/app/scripts/serve-dist-web.mjs",
  "packages/app/scripts/serve-dist-web-routing.mjs",
  "packages/docker-git-session-sync/dist",
  "packages/terminal/dist"
]) {
  addExistingPath(path)
}

for (const dependency of [...runtimeDependencies, ...extraRuntimePackages]) {
  addModulePath(`packages/app/node_modules/${dependency}`)
}

for (let index = 0; index < queue.length; index += 1) {
  scanSymlinks(queue[index])
}

const tempDir = mkdtempSync(resolve(tmpdir(), "docker-git-e2e-artifact-"))
const pathListPath = resolve(tempDir, "paths.txt")

try {
  writeFileSync(pathListPath, `${[...paths].sort().join("\n")}\n`)
  const tarResult = spawnSync("tar", ["-czf", outputAbsolutePath, "-T", pathListPath], {
    cwd: repoRoot,
    stdio: "inherit"
  })
  if (tarResult.status !== 0) {
    process.exit(tarResult.status ?? 1)
  }
} finally {
  rmSync(tempDir, { force: true, recursive: true })
}
