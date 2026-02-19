import * as Command from "@effect/platform/Command"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import type { TemplateConfig } from "../../src/core/domain.js"
import { applyProjectConfig, applyProjectFiles } from "../../src/usecases/apply.js"
import { prepareProjectFiles } from "../../src/usecases/actions/prepare-files.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-apply-config-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

const makeTemplateConfig = (
  root: string,
  outDir: string,
  path: Path.Path,
  targetDir: string
): TemplateConfig => ({
  containerName: "dg-test",
  serviceName: "dg-test",
  sshUser: "dev",
  sshPort: 2222,
  repoUrl: "https://github.com/org/repo.git",
  repoRef: "main",
  targetDir,
  volumeName: "dg-test-home",
  dockerGitPath: path.join(root, ".docker-git"),
  authorizedKeysPath: path.join(root, "authorized_keys"),
  envGlobalPath: path.join(root, ".orch/env/global.env"),
  envProjectPath: path.join(outDir, ".orch/env/project.env"),
  codexAuthPath: path.join(root, ".orch/auth/codex"),
  codexSharedAuthPath: path.join(root, ".orch/auth/codex-shared"),
  codexHome: "/home/dev/.codex",
  enableMcpPlaywright: false,
  pnpmVersion: "10.27.0"
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const rewriteTargetDirInConfig = (source: string, targetDir: string): string => {
  const parsed: unknown = JSON.parse(source)
  if (!isRecord(parsed)) {
    throw new Error("invalid docker-git.json root")
  }
  const template = parsed["template"]
  if (!isRecord(template)) {
    throw new Error("invalid docker-git.json template")
  }
  const next = { ...parsed, template: { ...template, targetDir } }
  return `${JSON.stringify(next, null, 2)}\n`
}

type ProcessPatch = {
  readonly prevCwd: string
  readonly prevProjectsRoot: string | undefined
}

const patchProcess = (cwd: string, projectsRoot: string): Effect.Effect<ProcessPatch, never> =>
  Effect.sync(() => {
    const prevCwd = process.cwd()
    const prevProjectsRoot = process.env["DOCKER_GIT_PROJECTS_ROOT"]
    process.chdir(cwd)
    process.env["DOCKER_GIT_PROJECTS_ROOT"] = projectsRoot
    return { prevCwd, prevProjectsRoot }
  })

const restorePatchedProcess = (patch: ProcessPatch): Effect.Effect<void, never> =>
  Effect.sync(() => {
    process.chdir(patch.prevCwd)
    if (patch.prevProjectsRoot === undefined) {
      delete process.env["DOCKER_GIT_PROJECTS_ROOT"]
    } else {
      process.env["DOCKER_GIT_PROJECTS_ROOT"] = patch.prevProjectsRoot
    }
  })

const withPatchedProcess = <A, E, R>(
  cwd: string,
  projectsRoot: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.scoped(
    Effect.acquireRelease(patchProcess(cwd, projectsRoot), restorePatchedProcess).pipe(
      Effect.flatMap(() => effect)
    )
  )

const runGit = (
  cwd: string,
  args: ReadonlyArray<string>
): Effect.Effect<void, unknown, never> =>
  Effect.gen(function*(_) {
    const command = Command.make("git", ...args).pipe(
      Command.workingDirectory(cwd),
      Command.env({ GIT_TERMINAL_PROMPT: "0" }),
      Command.stdout("pipe"),
      Command.stderr("pipe")
    )
    const exitCode = yield* _(Command.exitCode(command))
    expect(Number(exitCode)).toBe(0)
  }).pipe(Effect.asVoid)

describe("applyProjectFiles", () => {
  it.effect("applies updated docker-git.json to managed files in existing project", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const outDir = path.join(root, "project")
        const initialTargetDir = "/home/dev/workspaces/org/repo"
        const updatedTargetDir = "/home/dev/workspaces/org/repo-updated"
        const globalConfig = makeTemplateConfig(root, outDir, path, initialTargetDir)
        const projectConfig = makeTemplateConfig(root, outDir, path, initialTargetDir)

        yield* _(
          prepareProjectFiles(outDir, root, globalConfig, projectConfig, {
            force: false,
            forceEnv: false
          })
        )

        const envProjectPath = path.join(outDir, ".orch/env/project.env")
        yield* _(fs.writeFileString(envProjectPath, "# custom env\nCUSTOM_KEY=1\n"))

        const configPath = path.join(outDir, "docker-git.json")
        const configBefore = yield* _(fs.readFileString(configPath))
        yield* _(fs.writeFileString(configPath, rewriteTargetDirInConfig(configBefore, updatedTargetDir)))

        const appliedTemplate = yield* _(applyProjectFiles(outDir))
        expect(appliedTemplate.targetDir).toBe(updatedTargetDir)

        const composeAfter = yield* _(fs.readFileString(path.join(outDir, "docker-compose.yml")))
        expect(composeAfter).toContain(`TARGET_DIR: "${updatedTargetDir}"`)

        const dockerfileAfter = yield* _(fs.readFileString(path.join(outDir, "Dockerfile")))
        expect(dockerfileAfter).toContain(`RUN mkdir -p ${updatedTargetDir}`)

        const envAfter = yield* _(fs.readFileString(envProjectPath))
        expect(envAfter).toContain("CUSTOM_KEY=1")
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})

describe("applyProjectConfig", () => {
  it.effect("auto-resolves docker-git project by current repo and branch when projectDir is default", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)

        const projectsRoot = path.join(root, "projects-root")
        const projectDir = path.join(projectsRoot, "provercoderai", "docker-git", "issue-72")
        const workspaceRepoDir = path.join(root, "workspace", "docker-git")
        const initialTargetDir = "/home/dev/workspaces/provercoderai/docker-git"
        const updatedTargetDir = "/home/dev/workspaces/provercoderai/docker-git-updated"

        const globalConfig = makeTemplateConfig(root, projectDir, path, initialTargetDir)
        const projectConfig = {
          ...makeTemplateConfig(root, projectDir, path, initialTargetDir),
          repoUrl: "https://github.com/ProverCoderAI/docker-git.git",
          repoRef: "issue-72"
        }

        yield* _(
          prepareProjectFiles(projectDir, projectsRoot, globalConfig, projectConfig, {
            force: false,
            forceEnv: false
          })
        )

        const configPath = path.join(projectDir, "docker-git.json")
        const configBefore = yield* _(fs.readFileString(configPath))
        yield* _(fs.writeFileString(configPath, rewriteTargetDirInConfig(configBefore, updatedTargetDir)))

        yield* _(fs.makeDirectory(workspaceRepoDir, { recursive: true }))
        yield* _(runGit(workspaceRepoDir, ["init"]))
        yield* _(runGit(workspaceRepoDir, ["config", "user.email", "test@example.com"]))
        yield* _(runGit(workspaceRepoDir, ["config", "user.name", "test-user"]))
        yield* _(runGit(workspaceRepoDir, ["commit", "--allow-empty", "-m", "init"]))
        yield* _(runGit(workspaceRepoDir, ["checkout", "-b", "issue-72"]))
        yield* _(runGit(workspaceRepoDir, ["remote", "add", "origin", "https://github.com/skulidropek/docker-git.git"]))

        const applied = yield* _(
          withPatchedProcess(
            workspaceRepoDir,
            projectsRoot,
            applyProjectConfig({ _tag: "Apply", projectDir: ".", runUp: false })
          )
        )

        expect(applied.targetDir).toBe(updatedTargetDir)

        const composeAfter = yield* _(fs.readFileString(path.join(projectDir, "docker-compose.yml")))
        expect(composeAfter).toContain(`TARGET_DIR: "${updatedTargetDir}"`)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
