#!/usr/bin/env bun
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"

import { NodeContext } from "../../packages/lib/node_modules/@effect/platform-node"
import { defaultTemplateConfig, type TemplateConfig } from "../../packages/container/dist/index.js"
import { writeProjectFiles } from "../../packages/lib/dist/shell/files.js"
import { Effect } from "../../packages/lib/node_modules/effect"

const args = process.argv.slice(2)
const shouldDryRun = args.includes("--dry-run")
const imageName = args.find((arg) => arg !== "--dry-run") ?? "docker-git-e2e-project:latest"
const tempDir = mkdtempSync(resolve(tmpdir(), "docker-git-e2e-project-"))

const run = (command: string, args: ReadonlyArray<string>, cwd: string): void => {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

const config: TemplateConfig = {
  ...defaultTemplateConfig,
  containerName: "docker-git-e2e-project",
  serviceName: "docker-git-e2e-project",
  repoUrl: "https://github.com/octocat/Hello-World.git",
  repoRef: "main",
  skipGithubAuth: true,
  targetDir: "/home/dev",
  volumeName: "docker-git-e2e-project-home"
}

try {
  await Effect.runPromise(
    writeProjectFiles(tempDir, config, true).pipe(Effect.provide(NodeContext.layer))
  )
  if (shouldDryRun) {
    console.log(`Prepared E2E project image context: ${tempDir}`)
  } else {
    run("docker", ["build", "--tag", imageName, "."], tempDir)
    run("docker", ["image", "inspect", imageName, "--format", "{{.Id}}"], tempDir)
  }
} finally {
  rmSync(tempDir, { force: true, recursive: true })
}
