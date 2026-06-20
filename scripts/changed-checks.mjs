#!/usr/bin/env bun
// CHANGE: Add a workspace-aware affected-check runner for lint/test/typecheck.
// WHY: issue #432 asks to run checks only for changed code while failing closed for global/tooling changes.
// QUOTE(ТЗ): "настроить кеш вызова тестов и линтеров. Что бы они гонялись только на изменённый код"
// REF: issue-432
// SOURCE: n/a
// FORMAT THEOREM: forall changed paths P: global(P) -> fullRun(P); package(P) -> affectedClosure(P); docsOnly(P) -> skip(P)
// PURITY: SHELL entrypoint with pure planner exports
// EFFECT: child_process spawn for git and check commands
// INVARIANT: unknown or uncomputable diff never skips checks
// COMPLEXITY: O(p + e + f log f) where p = packages, e = workspace dependency edges, f = changed files

import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const operations = new Set(["check", "lint", "lint:effect", "test", "typecheck"])

const fullRunExactPaths = new Set([
  ".gitignore",
  "bun.lock",
  "bunfig.toml",
  "eslint.effect-ts-shared.mjs",
  "package.json",
  "tsconfig.base.json",
  "tsconfig.json"
])

const fullRunPrefixes = [".github/", "scripts/"]

const dependencySections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]

const commandGroups = {
  check: ["typecheck", "lint", "test"],
  lint: ["lint"],
  "lint:effect": ["lint:effect"],
  test: ["test"],
  typecheck: ["typecheck"]
}

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value)

const normalizePath = (value) => value.replaceAll("\\", "/").replace(/^\.\/+/u, "").replace(/\/+/gu, "/")

const uniqueSorted = (values) => [...new Set(values)].sort((left, right) => left.localeCompare(right))

const shellQuote = (value) => {
  if (/^[A-Za-z0-9_./:@=-]+$/u.test(value)) {
    return value
  }
  return `'${value.replaceAll("'", "'\\''")}'`
}

const formatCommand = (command) => [command.command, ...command.args].map(shellQuote).join(" ")

const isDocsOnlyPath = (filePath) =>
  filePath === "README.md" ||
  filePath.startsWith("docs/") ||
  (filePath.endsWith(".md") && !filePath.startsWith("packages/"))

const isFullRunPath = (filePath) =>
  fullRunExactPaths.has(filePath) || fullRunPrefixes.some((prefix) => filePath.startsWith(prefix))

const packageForPath = (packages, filePath) =>
  packages.find((workspacePackage) => filePath === workspacePackage.dir || filePath.startsWith(`${workspacePackage.dir}/`)) ??
  null

const packageNamesWithScript = (packages, scriptName) =>
  packages.filter((workspacePackage) => workspacePackage.scripts[scriptName] !== undefined).map((workspacePackage) =>
    workspacePackage.name
  )

const dependencyNameSet = (manifest) => {
  const names = []

  for (const section of dependencySections) {
    const dependencies = manifest[section]
    if (!isRecord(dependencies)) {
      continue
    }

    for (const [name, version] of Object.entries(dependencies)) {
      if (typeof version === "string" && version.startsWith("workspace:")) {
        names.push(name)
      }
    }
  }

  return uniqueSorted(names)
}

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"))

export const loadWorkspacePackages = (rootDir = process.cwd()) => {
  const rootPackage = readJson(path.join(rootDir, "package.json"))
  const workspaces = Array.isArray(rootPackage.workspaces) ? rootPackage.workspaces : []
  const packages = []

  for (const workspace of workspaces) {
    if (typeof workspace !== "string" || workspace.includes("*")) {
      continue
    }

    const manifestPath = path.join(rootDir, workspace, "package.json")
    if (!fs.existsSync(manifestPath)) {
      continue
    }

    const manifest = readJson(manifestPath)
    if (typeof manifest.name !== "string" || !isRecord(manifest.scripts)) {
      continue
    }

    packages.push({
      dependencyNames: dependencyNameSet(manifest),
      dir: normalizePath(workspace),
      name: manifest.name,
      scripts: Object.fromEntries(
        Object.entries(manifest.scripts).filter((entry) => typeof entry[1] === "string")
      )
    })
  }

  return packages
}

const reverseDependencyMap = (packages) => {
  const workspaceNames = new Set(packages.map((workspacePackage) => workspacePackage.name))
  const reverse = new Map(packages.map((workspacePackage) => [workspacePackage.name, []]))

  for (const workspacePackage of packages) {
    for (const dependencyName of workspacePackage.dependencyNames) {
      if (!workspaceNames.has(dependencyName)) {
        continue
      }

      reverse.set(dependencyName, [...(reverse.get(dependencyName) ?? []), workspacePackage.name])
    }
  }

  return reverse
}

const affectedClosure = (packages, ownerNames) => {
  const reverse = reverseDependencyMap(packages)
  const queue = [...ownerNames]
  const seen = new Set(ownerNames)

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]
    for (const dependentName of reverse.get(current) ?? []) {
      if (seen.has(dependentName)) {
        continue
      }

      seen.add(dependentName)
      queue.push(dependentName)
    }
  }

  return topologicalPackageNames(packages, [...seen])
}

const topologicalPackageNames = (packages, selectedNames) => {
  const selected = new Set(selectedNames)
  const ordered = []
  const visiting = new Set()
  const visited = new Set()
  const byName = new Map(packages.map((workspacePackage) => [workspacePackage.name, workspacePackage]))

  const visit = (packageName) => {
    if (visited.has(packageName) || visiting.has(packageName)) {
      return
    }

    const workspacePackage = byName.get(packageName)
    if (workspacePackage === undefined) {
      return
    }

    visiting.add(packageName)
    for (const dependencyName of workspacePackage.dependencyNames) {
      if (selected.has(dependencyName)) {
        visit(dependencyName)
      }
    }
    visiting.delete(packageName)
    visited.add(packageName)
    ordered.push(packageName)
  }

  for (const workspacePackage of packages) {
    if (selected.has(workspacePackage.name)) {
      visit(workspacePackage.name)
    }
  }

  return ordered
}

const selectedPackageNames = (packages, scriptName, names) => {
  const requested = new Set(names)
  return topologicalPackageNames(
    packages,
    packages
      .filter((workspacePackage) => requested.has(workspacePackage.name) && workspacePackage.scripts[scriptName] !== undefined)
      .map((workspacePackage) => workspacePackage.name)
  )
}

const packageScriptCommand = (workspacePackage, scriptName, phase = scriptName) => ({
  args: ["run", "--filter", workspacePackage.name, scriptName],
  command: "bun",
  packageName: workspacePackage.name,
  phase,
  serial: workspacePackage.scripts[`pre${scriptName}`] !== undefined,
  scriptName
})

const operationPackageNames = ({ affectedNames, all, group, ownerNames, packages }) => {
  if (all) {
    return packageNamesWithScript(packages, group)
  }

  if (group === "lint" || group === "lint:effect") {
    return ownerNames
  }

  return affectedNames
}

const buildCommandsForGroup = (input) => {
  const names = operationPackageNames(input)
  const packageByName = new Map(input.packages.map((workspacePackage) => [workspacePackage.name, workspacePackage]))
  const primaryCommands = selectedPackageNames(input.packages, input.group, names).map((packageName) =>
    packageScriptCommand(packageByName.get(packageName), input.group, input.group)
  )

  if (input.group !== "lint") {
    return primaryCommands
  }

  const testLintOwners = input.all
    ? packageNamesWithScript(input.packages, "lint:tests")
    : uniqueSorted(input.changedFiles.flatMap((filePath) => {
      const workspacePackage = packageForPath(input.packages, filePath)
      if (workspacePackage === null || !filePath.startsWith(`${workspacePackage.dir}/tests/`)) {
        return []
      }
      return [workspacePackage.name]
    }))

  const testLintCommands = selectedPackageNames(input.packages, "lint:tests", testLintOwners).map((packageName) =>
    packageScriptCommand(packageByName.get(packageName), "lint:tests", "lint")
  )

  return [...primaryCommands, ...testLintCommands]
}

const changedOwnerNames = (packages, changedFiles) =>
  uniqueSorted(changedFiles.flatMap((filePath) => {
    const workspacePackage = packageForPath(packages, filePath)
    return workspacePackage === null ? [] : [workspacePackage.name]
  }))

const unknownChangedFiles = (packages, changedFiles) =>
  changedFiles.filter((filePath) => !isDocsOnlyPath(filePath) && !isFullRunPath(filePath) && packageForPath(packages, filePath) === null)

const planMode = ({ all, changedFiles, diffFailed, packages }) => {
  if (all) {
    return { mode: "all", reason: "explicit --all" }
  }

  if (diffFailed) {
    return { mode: "all", reason: "changed-file detection failed" }
  }

  if (changedFiles.length === 0) {
    return { mode: "skip", reason: "no changed files" }
  }

  const fullRunPath = changedFiles.find(isFullRunPath)
  if (fullRunPath !== undefined) {
    return { mode: "all", reason: `global change: ${fullRunPath}` }
  }

  const unknownPath = unknownChangedFiles(packages, changedFiles)[0]
  if (unknownPath !== undefined) {
    return { mode: "all", reason: `unknown change: ${unknownPath}` }
  }

  if (changedOwnerNames(packages, changedFiles).length === 0) {
    return { mode: "skip", reason: "docs-only changes" }
  }

  return { mode: "affected", reason: "package-scoped changes" }
}

export const createChangedChecksPlan = ({ all = false, changedFiles, diffFailed = false, operation, packages }) => {
  const normalizedChangedFiles = uniqueSorted(changedFiles.map(normalizePath).filter((filePath) => filePath.length > 0))
  const modeResult = planMode({ all, changedFiles: normalizedChangedFiles, diffFailed, packages })
  const ownerNames = modeResult.mode === "all" ? packages.map((workspacePackage) => workspacePackage.name) : changedOwnerNames(packages, normalizedChangedFiles)
  const affectedNames = modeResult.mode === "all"
    ? packages.map((workspacePackage) => workspacePackage.name)
    : affectedClosure(packages, ownerNames)
  const groups = commandGroups[operation] ?? []

  if (modeResult.mode === "skip") {
    return {
      affectedPackages: [],
      changedFiles: normalizedChangedFiles,
      commands: [],
      mode: modeResult.mode,
      operation,
      ownerPackages: [],
      reason: modeResult.reason
    }
  }

  const commands = groups.flatMap((group) =>
    buildCommandsForGroup({
      affectedNames,
      all: modeResult.mode === "all",
      changedFiles: normalizedChangedFiles,
      group,
      ownerNames,
      packages
    })
  )

  return {
    affectedPackages: modeResult.mode === "all" ? packageNamesInCommands(commands) : affectedNames,
    changedFiles: normalizedChangedFiles,
    commands,
    mode: modeResult.mode,
    operation,
    ownerPackages: ownerNames,
    reason: modeResult.reason
  }
}

const packageNamesInCommands = (commands) => uniqueSorted(commands.map((command) => command.packageName))

export const parseChangedChecksArgs = (args) => {
  const [operation, ...rest] = args
  if (!operations.has(operation)) {
    throw new Error(`Usage: bun scripts/changed-checks.mjs <${[...operations].join("|")}> [--base <rev>] [--head <rev>] [--all] [--dry-run] [--matrix] [--concurrency <n>]`)
  }

  const parsed = {
    all: false,
    base: process.env.DOCKER_GIT_CHANGED_BASE || "",
    concurrency: Math.max(1, Number.parseInt(process.env.DOCKER_GIT_CHECK_CONCURRENCY || "4", 10) || 4),
    dryRun: false,
    head: process.env.DOCKER_GIT_CHANGED_HEAD || "HEAD",
    matrix: false,
    operation
  }

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (arg === "--all") {
      parsed.all = true
      continue
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true
      continue
    }
    if (arg === "--matrix") {
      parsed.matrix = true
      continue
    }
    if (arg === "--concurrency") {
      parsed.concurrency = Math.max(1, Number.parseInt(rest[index + 1] ?? "4", 10) || 4)
      index += 1
      continue
    }
    if (arg === "--base") {
      parsed.base = rest[index + 1] ?? ""
      index += 1
      continue
    }
    if (arg === "--head") {
      parsed.head = rest[index + 1] ?? "HEAD"
      index += 1
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return parsed
}

const runCapture = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" })
  return {
    ok: result.status === 0,
    stdout: result.stdout.trim()
  }
}

const lines = (text) => text.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line.length > 0)

const changedFilesFromGit = ({ base, head, rootDir }) => {
  if (base.length > 0) {
    const mergeBase = runCapture("git", ["merge-base", base, head], rootDir)
    if (!mergeBase.ok || mergeBase.stdout.length === 0) {
      return { changedFiles: [], diffFailed: true }
    }

    const diff = runCapture("git", ["diff", "--name-only", "--diff-filter=ACMR", mergeBase.stdout, head, "--"], rootDir)
    return diff.ok
      ? { changedFiles: lines(diff.stdout), diffFailed: false }
      : { changedFiles: [], diffFailed: true }
  }

  if (process.env.CI === "true") {
    return { changedFiles: [], diffFailed: true }
  }

  const tracked = runCapture("git", ["diff", "--name-only", "--diff-filter=ACMR", "HEAD", "--"], rootDir)
  const untracked = runCapture("git", ["ls-files", "--others", "--exclude-standard"], rootDir)
  if (!tracked.ok || !untracked.ok) {
    return { changedFiles: [], diffFailed: true }
  }

  return {
    changedFiles: uniqueSorted([...lines(tracked.stdout), ...lines(untracked.stdout)]),
    diffFailed: false
  }
}

const printPlan = (plan) => {
  console.log(`changed-checks: ${plan.operation} ${plan.mode} (${plan.reason})`)
  if (plan.changedFiles.length > 0) {
    console.log(`changed-checks: files ${plan.changedFiles.join(", ")}`)
  }
  if (plan.ownerPackages.length > 0) {
    console.log(`changed-checks: owners ${plan.ownerPackages.join(", ")}`)
  }
  if (plan.affectedPackages.length > 0) {
    console.log(`changed-checks: affected ${plan.affectedPackages.join(", ")}`)
  }
  if (plan.commands.length === 0) {
    console.log("changed-checks: no commands to run")
    return
  }

  for (const command of plan.commands) {
    console.log(`changed-checks: run ${formatCommand(command)}`)
  }
}

export const createGithubMatrix = (plan) => ({
  include: plan.commands.map((command) => ({
    label: `${command.packageName} ${command.scriptName}`,
    packageName: command.packageName,
    script: command.scriptName
  }))
})

const runOneCommand = (command, rootDir) =>
  new Promise((resolve) => {
    const child = spawn(command.command, command.args, {
      cwd: rootDir,
      env: process.env,
      stdio: "inherit"
    })

    child.on("error", () => resolve(1))
    child.on("close", (code) => resolve(code ?? 1))
  })

const runCommandPhase = async (commands, rootDir, concurrency) => {
  let next = 0
  let firstFailure = 0
  const workerCount = Math.min(concurrency, commands.length)

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (next < commands.length && firstFailure === 0) {
      const command = commands[next]
      next += 1
      const status = await runOneCommand(command, rootDir)
      if (status !== 0 && firstFailure === 0) {
        firstFailure = status
      }
    }
  }))

  return firstFailure
}

const groupedByPhase = (commands) => {
  const phases = []
  const byPhase = new Map()

  for (const command of commands) {
    if (!byPhase.has(command.phase)) {
      byPhase.set(command.phase, [])
      phases.push(command.phase)
    }
    byPhase.get(command.phase).push(command)
  }

  return phases.map((phase) => byPhase.get(phase))
}

const runCommands = async (commands, rootDir, concurrency) => {
  for (const phaseCommands of groupedByPhase(commands)) {
    const serialCommands = phaseCommands.filter((command) => command.serial)
    const parallelCommands = phaseCommands.filter((command) => !command.serial)
    const serialStatus = await runCommandPhase(serialCommands, rootDir, 1)
    if (serialStatus !== 0) {
      return serialStatus
    }
    const status = await runCommandPhase(parallelCommands, rootDir, concurrency)
    if (status !== 0) {
      return status
    }
  }

  return 0
}

export const runChangedChecksCli = async (argv, rootDir = process.cwd()) => {
  const args = parseChangedChecksArgs(argv)
  const packages = loadWorkspacePackages(rootDir)
  const diff = changedFilesFromGit({ base: args.base, head: args.head, rootDir })
  const plan = createChangedChecksPlan({
    all: args.all,
    changedFiles: diff.changedFiles,
    diffFailed: diff.diffFailed,
    operation: args.operation,
    packages
  })

  if (args.matrix) {
    console.log(JSON.stringify(createGithubMatrix(plan)))
    return 0
  }

  printPlan(plan)
  if (args.dryRun || plan.commands.length === 0) {
    return 0
  }

  return await runCommands(plan.commands, rootDir, args.concurrency)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runChangedChecksCli(process.argv.slice(2))
}
