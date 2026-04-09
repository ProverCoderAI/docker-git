import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import type { TemplateConfig } from "../../src/core/domain.js"
import { runCommandExitCode } from "../../src/shell/command-runner.js"
import { prepareProjectFiles } from "../../src/usecases/actions/prepare-files.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-force-env-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

const withPatchedEnv = <A, E, R>(
  patch: Readonly<Record<string, string | undefined>>,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = new Map<string, string | undefined>()
      for (const [key, value] of Object.entries(patch)) {
        previous.set(key, process.env[key])
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of previous.entries()) {
          if (value === undefined) {
            delete process.env[key]
          } else {
            process.env[key] = value
          }
        }
      })
  )

const withWorkingDirectory = <A, E, R>(
  cwd: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.cwd()
      process.chdir(cwd)
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        process.chdir(previous)
      })
  )

const failOnCopyFile = (
  fs: FileSystem.FileSystem,
  label: string
): FileSystem.FileSystem => ({
  ...fs,
  copyFile: () => Effect.dieMessage(`${label}: unexpected copyFile`)
})

const makeGlobalConfig = (root: string, path: Path.Path): TemplateConfig => ({
  containerName: "dg-test",
  serviceName: "dg-test",
  sshUser: "dev",
  sshPort: 2222,
  repoUrl: "https://github.com/org/repo.git",
  repoRef: "main",
  gitTokenLabel: undefined,
  skipGithubAuth: false,
  targetDir: "/home/dev/org/repo",
  volumeName: "dg-test-home",
  dockerGitPath: path.join(root, ".docker-git"),
  authorizedKeysPath: path.join(root, "authorized_keys"),
  envGlobalPath: path.join(root, ".orch/env/global.env"),
  envProjectPath: path.join(root, ".orch/env/project.env"),
  codexAuthPath: path.join(root, ".orch/auth/codex"),
  codexSharedAuthPath: path.join(root, ".orch/auth/codex-shared"),
  codexHome: "/home/dev/.codex",
  dockerNetworkMode: "shared",
  dockerSharedNetworkName: "docker-git-shared",
  enableMcpPlaywright: false,
  bunVersion: "1.3.11"
})

const makeProjectConfig = (
  outDir: string,
  enableMcpPlaywright: boolean,
  path: Path.Path,
  gitTokenLabel?: string,
  codexAuthLabel?: string,
  claudeAuthLabel?: string
): TemplateConfig => ({
  containerName: "dg-test",
  serviceName: "dg-test",
  sshUser: "dev",
  sshPort: 2222,
  repoUrl: "https://github.com/org/repo.git",
  repoRef: "main",
  gitTokenLabel,
  skipGithubAuth: false,
  codexAuthLabel,
  claudeAuthLabel,
  targetDir: "/home/dev/org/repo",
  volumeName: "dg-test-home",
  dockerGitPath: path.join(outDir, ".docker-git"),
  authorizedKeysPath: path.join(outDir, "authorized_keys"),
  envGlobalPath: path.join(outDir, ".orch/env/global.env"),
  envProjectPath: path.join(outDir, ".orch/env/project.env"),
  codexAuthPath: path.join(outDir, ".orch/auth/codex"),
  codexSharedAuthPath: path.join(outDir, ".orch/auth/codex-shared"),
  codexHome: "/home/dev/.codex",
  dockerNetworkMode: "shared",
  dockerSharedNetworkName: "docker-git-shared",
  enableMcpPlaywright,
  bunVersion: "1.3.11"
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const readEnableMcpPlaywrightFlag = (value: unknown): boolean | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const template = value.template
  if (!isRecord(template)) {
    return undefined
  }

  const flag = template.enableMcpPlaywright
  return typeof flag === "boolean" ? flag : undefined
}

const countOccurrences = (source: string, fragment: string): number =>
  source.split(fragment).length - 1

describe("prepareProjectFiles", () => {
  it.effect("force-env refresh rewrites managed templates", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const outDir = path.join(root, "project")
        const globalConfig = makeGlobalConfig(root, path)
        const withoutMcp = makeProjectConfig(outDir, false, path)
        const withMcp = makeProjectConfig(outDir, true, path, "AGIENS", "agien-codex", "agien-claude")

        yield* _(
          prepareProjectFiles(outDir, root, globalConfig, withoutMcp, {
            force: false,
            forceEnv: false
          })
        )

        const dockerfile = yield* _(fs.readFileString(path.join(outDir, "Dockerfile")))
        const entrypointPath = path.join(outDir, "entrypoint.sh")
        const entrypoint = yield* _(fs.readFileString(entrypointPath))
        const composeBefore = yield* _(fs.readFileString(path.join(outDir, "docker-compose.yml")))
        const dnsBlock = "    dns:\n      - 8.8.8.8\n      - 8.8.4.4\n      - 1.1.1.1"
        const entrypointSyntaxExitCode = yield* _(
          runCommandExitCode({
            cwd: outDir,
            command: "bash",
            args: ["-n", entrypointPath]
          })
        )
        expect(entrypointSyntaxExitCode).toBe(0)
        expect(dockerfile).toContain("docker-compose-v2")
        expect(dockerfile).toContain("gitleaks version")
        expect(dockerfile).toContain(
          "curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 https://bun.sh/install -o /tmp/bun-install.sh"
        )
        expect(dockerfile).toContain("bun install attempt ${attempt} failed; retrying...")
        expect(dockerfile).not.toContain("COPY authorized_keys /opt/docker-git/bootstrap/authorized_keys")
        expect(dockerfile).not.toContain("COPY .orch /opt/docker-git/bootstrap/.orch")
        expect(dockerfile).toContain("RUN mkdir -p /opt/docker-git/bootstrap/.orch/auth/codex")
        expect(entrypoint).toContain('DOCKER_GIT_HOME="/home/dev/.docker-git"')
        expect(entrypoint).toContain('BOOTSTRAP_ROOT="/opt/docker-git/bootstrap"')
        expect(entrypoint).toContain('BOOTSTRAP_CODEX_SHARED_AUTH_DIR="$BOOTSTRAP_SOURCE_ROOT/shared-auth/codex"')
        expect(entrypoint).toContain("docker_git_export_env_if_unset()")
        expect(entrypoint).toContain('if [[ -n "${!key+x}" ]]; then')
        expect(entrypoint).toContain('docker_git_upsert_ssh_env "$key" "${!key}"')
        expect(entrypoint).toContain('docker_git_load_env_file "$DOCKER_GIT_ENV_GLOBAL"')
        expect(entrypoint).toContain('docker_git_load_env_file "$DOCKER_GIT_ENV_PROJECT"')
        expect(entrypoint).not.toContain('export "$line"')
        expect(entrypoint).toContain('CODEX_LABEL_RAW="$CODEX_AUTH_LABEL"')
        expect(entrypoint).toContain('OPENCODE_DATA_DIR="/home/dev/.local/share/opencode"')
        expect(entrypoint).toContain('OPENCODE_SHARED_HOME="/home/dev/.codex-shared/opencode"')
        expect(entrypoint).toContain('OPENCODE_CONFIG_DIR="/home/dev/.config/opencode"')
        expect(entrypoint).toContain('su - dev -s /bin/bash -c "bash -lc')
        expect(entrypoint).toContain('. /etc/profile 2>/dev/null || true;')
        expect(entrypoint).toContain("codex exec")
        expect(entrypoint).not.toContain("codex --approval-mode full-auto")
        expect(entrypoint).toContain("docker_git_sync_project_codex_skills()")
        expect(entrypoint).toContain('project_skills_root="$codex_home/skills/.docker-git-project"')
        expect(entrypoint).toContain("docker_git_prepare_active_agent_project_rules()")
        expect(entrypoint).toContain('"10-root-skills::.skills"')
        expect(entrypoint).toContain('"20-agents-skills::.agents/skills"')
        expect(entrypoint).toContain('"90-codex-dot-skills::.codex/.skills"')
        expect(entrypoint).not.toContain('"40-claude-skills::.claude/skills"')
        expect(entrypoint).toContain('$project_dir/.claude/settings.json')
        expect(entrypoint).toContain('$project_dir/.gemini/settings.json')
        expect(entrypoint).toContain("docker_git_repair_dns() {")
        expect(entrypoint).toContain('local test_domain="github.com"')
        expect(entrypoint).toContain('local fallback_dns="8.8.8.8 8.8.4.4 1.1.1.1"')
        expect(entrypoint).toContain('printf "nameserver %s\\n" "$ns" >> "$resolv"')
        expect(entrypoint).toContain("docker_git_repair_dns || true")
        expect(entrypoint).toContain('"plugin": ["oh-my-opencode"]')
        expect(entrypoint).toContain("branch '$REPO_REF' missing; retrying without --branch")
        expect(entrypoint).not.toContain("git ls-remote --symref")
        expect(entrypoint).toContain("cat > \"$MOVE_SCRIPT\" << 'EOFMOVE'")
        expect(entrypoint).toMatch(/\nEOFMOVE\n\s*chmod \+x "\$MOVE_SCRIPT"/)
        expect(entrypoint).not.toContain("\n  EOFMOVE\n")
        expect(entrypoint).toContain('sync_file_if_present "$BOOTSTRAP_AUTH_KEYS" "$DOCKER_GIT_AUTH_KEYS" || true')
        expect(entrypoint).toContain('sync_labeled_auth_files "$BOOTSTRAP_CODEX_SHARED_AUTH_DIR" "$DOCKER_GIT_AUTH_DIR"')
        expect(entrypoint).not.toContain('SOURCE_SHARED_AUTH="/home/dev/.codex-shared/auth.json"')
        expect(entrypoint).not.toContain('SOURCE_LOCAL_AUTH="/home/dev/.codex/auth.json"')
        expect(entrypoint).not.toContain('copy_if_distinct_file "$SOURCE_SHARED_AUTH" "$DOCKER_GIT_AUTH_DIR/auth.json"')
        expect(entrypoint).not.toContain('copy_if_distinct_file "$SOURCE_LOCAL_AUTH" "$DOCKER_GIT_AUTH_DIR/auth.json"')
        expect(entrypoint).not.toContain("if (opencode.openai) {")
        expect(entrypoint).toContain('rm -f "$SHARED_AUTH_FILE" || true')
        expect(entrypoint).toContain(
          "if [[ \"$CLONE_OK\" -eq 1 ]]; then\n  docker_git_prepare_active_agent_project_rules\nfi"
        )
        expect(composeBefore).toContain("container_name: dg-test")
        expect(composeBefore).toContain("restart: unless-stopped")
        expect(composeBefore).not.toContain(":/home/dev/.docker-git\n")
        expect(composeBefore).toContain("docker_git_shared_cache:/home/dev/.docker-git/.cache")
        expect(composeBefore).toContain("docker_git_shared_codex:/home/dev/.codex-shared")
        expect(composeBefore).toContain("docker_git_bootstrap:/opt/docker-git/bootstrap/source:ro")
        expect(composeBefore).toContain("docker_git_bootstrap:")
        expect(composeBefore).toContain("name: dg-test-home-bootstrap")
        expect(composeBefore).toContain("env_file:")
        expect(composeBefore).toContain(`      - ${path.join(outDir, ".orch/env/global.env")}`)
        expect(composeBefore).toContain(`      - ${path.join(outDir, ".orch/env/project.env")}`)
        expect(composeBefore).toContain("cpus:")
        expect(composeBefore).toContain('mem_limit: "')
        expect(composeBefore).not.toContain("dg-test-browser")
        expect(composeBefore).toContain("docker-git-shared")
        expect(composeBefore).toContain("docker-git-shared-codex")
        expect(composeBefore).toContain("external: true")
        expect(countOccurrences(composeBefore, dnsBlock)).toBe(1)

        yield* _(
          prepareProjectFiles(outDir, root, globalConfig, withMcp, {
            force: false,
            forceEnv: true
          })
        )

        const composeAfter = yield* _(fs.readFileString(path.join(outDir, "docker-compose.yml")))
        const configAfterText = yield* _(fs.readFileString(path.join(outDir, "docker-git.json")))
        const configAfter = yield* _(Effect.sync((): unknown => JSON.parse(configAfterText)))

        expect(composeAfter).toContain("dg-test-browser")
        expect(composeAfter).toContain('MCP_PLAYWRIGHT_ENABLE: "1"')
        expect(composeAfter).toContain('GITHUB_AUTH_LABEL: "AGIENS"')
        expect(composeAfter).toContain('GIT_AUTH_LABEL: "AGIENS"')
        expect(composeAfter).toContain('CODEX_AUTH_LABEL: "agien-codex"')
        expect(composeAfter).toContain('CLAUDE_AUTH_LABEL: "agien-claude"')
        expect(composeAfter).toContain("container_name: dg-test")
        expect(composeAfter).toContain("container_name: dg-test-browser")
        expect(composeAfter).toContain("container_name: dg-test-browser\n    restart: unless-stopped")
        expect(composeAfter).toContain(`      - ${path.join(outDir, ".orch/env/global.env")}`)
        expect(composeAfter).toContain(`      - ${path.join(outDir, ".orch/env/project.env")}`)
        expect(composeAfter).toContain("docker-git-shared")
        expect(composeAfter).toContain("external: true")
        expect(countOccurrences(composeAfter, dnsBlock)).toBe(2)
        expect(readEnableMcpPlaywrightFlag(configAfter)).toBe(true)
        expect(configAfterText).toContain('"cpuLimit": "30%"')
        expect(configAfterText).toContain('"ramLimit": "30%"')
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("renders project-scoped network when dockerNetworkMode=project", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const outDir = path.join(root, "project-mode")
        const globalConfig = makeGlobalConfig(root, path)
        const projectConfig = {
          ...makeProjectConfig(outDir, false, path),
          dockerNetworkMode: "project"
        }

        yield* _(
          prepareProjectFiles(outDir, root, globalConfig, projectConfig, {
            force: false,
            forceEnv: false
          })
        )

        const compose = yield* _(fs.readFileString(path.join(outDir, "docker-compose.yml")))
        expect(compose).toContain("dg-test-net")
        expect(compose).toContain("driver: bridge")
        expect(compose).not.toContain("dg-test-net:\n    external: true")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("copies docker-git scripts from the workspace root when cwd is a nested package", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const packageDir = path.join(root, "packages", "api")
        const scriptsDir = path.join(root, "scripts")
        const outDir = path.join(root, "project-with-scripts")
        const globalConfig = makeGlobalConfig(root, path)
        const projectConfig = makeProjectConfig(outDir, false, path)

        yield* _(fs.makeDirectory(packageDir, { recursive: true }))
        yield* _(fs.makeDirectory(scriptsDir, { recursive: true }))
        yield* _(fs.writeFileString(path.join(root, "bunfig.toml"), "[install]\nlinkWorkspacePackages = true\n"))
        yield* _(fs.writeFileString(path.join(scriptsDir, "session-backup-gist.js"), "#!/usr/bin/env bun\n"))

        yield* _(
          withWorkingDirectory(
            packageDir,
            prepareProjectFiles(outDir, packageDir, globalConfig, projectConfig, {
              force: false,
              forceEnv: false
            })
          )
        )

        expect(yield* _(fs.exists(path.join(outDir, "scripts", "session-backup-gist.js")))).toBe(true)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("appends the active public key to the managed authorized_keys file", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const homeDir = path.join(root, "home")
        const projectsRoot = path.join(homeDir, ".docker-git")
        const outDir = path.join(projectsRoot, "org", "repo")
        const authorizedKeysPath = path.join(projectsRoot, "authorized_keys")
        const sshPrivateKeyPath = path.join(homeDir, ".ssh", "id_ed25519")
        const sshPublicKeyPath = `${sshPrivateKeyPath}.pub`
        const staleKey = "ssh-ed25519 AAAA-stale stale@example\n"
        const currentKey = "ssh-ed25519 AAAA-current current@example\n"
        const globalConfig = makeGlobalConfig(projectsRoot, path)
        const projectConfig = {
          ...makeProjectConfig(outDir, false, path),
          authorizedKeysPath: "../../authorized_keys"
        }

        yield* _(fs.makeDirectory(path.dirname(authorizedKeysPath), { recursive: true }))
        yield* _(fs.makeDirectory(path.dirname(sshPrivateKeyPath), { recursive: true }))
        yield* _(fs.writeFileString(authorizedKeysPath, staleKey))
        yield* _(fs.writeFileString(sshPrivateKeyPath, "PRIVATE\n"))
        yield* _(fs.writeFileString(sshPublicKeyPath, currentKey))

        yield* _(
          withPatchedEnv(
            {
              HOME: homeDir,
              DOCKER_GIT_PROJECTS_ROOT: projectsRoot,
              DOCKER_GIT_AUTHORIZED_KEYS: undefined,
              DOCKER_GIT_SSH_KEY: undefined
            },
            prepareProjectFiles(outDir, projectsRoot, globalConfig, projectConfig, {
              force: false,
              forceEnv: false
            })
          )
        )

        const synchronizedAuthorizedKeys = yield* _(fs.readFileString(authorizedKeysPath))
        expect(synchronizedAuthorizedKeys).toContain(staleKey.trim())
        expect(synchronizedAuthorizedKeys).toContain(currentKey.trim())
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("force refresh appends new keys into an existing project authorized_keys file", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const outDir = path.join(root, "project")
        const globalConfig = makeGlobalConfig(root, path)
        const projectConfig = makeProjectConfig(outDir, false, path)
        const sourceAuthorizedKeysPath = path.join(root, "authorized_keys")
        const projectAuthorizedKeysPath = path.join(outDir, "authorized_keys")
        const staleKey = "ssh-ed25519 AAAA-stale stale@example\n"
        const currentKey = "ssh-ed25519 AAAA-current current@example\n"

        yield* _(fs.makeDirectory(path.dirname(projectAuthorizedKeysPath), { recursive: true }))
        yield* _(fs.writeFileString(sourceAuthorizedKeysPath, currentKey))
        yield* _(fs.writeFileString(projectAuthorizedKeysPath, staleKey))

        yield* _(
          prepareProjectFiles(outDir, root, globalConfig, projectConfig, {
            force: true,
            forceEnv: false
          })
        )

        const synchronizedAuthorizedKeys = yield* _(fs.readFileString(projectAuthorizedKeysPath))
        expect(synchronizedAuthorizedKeys).toContain(staleKey.trim())
        expect(synchronizedAuthorizedKeys).toContain(currentKey.trim())
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("creates authorized_keys from the already-read snapshot without low-level copyFile", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const outDir = path.join(root, "project")
        const globalConfig = makeGlobalConfig(root, path)
        const projectConfig = makeProjectConfig(outDir, false, path)
        const sourceAuthorizedKeysPath = path.join(root, "authorized_keys")
        const currentKey = "ssh-ed25519 AAAA-current current@example\n"

        yield* _(fs.writeFileString(sourceAuthorizedKeysPath, currentKey))

        yield* _(
          prepareProjectFiles(outDir, root, globalConfig, projectConfig, {
            force: false,
            forceEnv: false
          }).pipe(Effect.provideService(FileSystem.FileSystem, failOnCopyFile(fs, "prepareProjectFiles")))
        )

        expect(yield* _(fs.readFileString(path.join(outDir, "authorized_keys")))).toBe(currentKey)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("ignores missing Claude debug symlinks when seeding project auth", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const outDir = path.join(root, "project")
        const globalConfig = makeGlobalConfig(root, path)
        const projectConfig = makeProjectConfig(outDir, false, path)
        const sourceClaudeDefault = path.join(root, ".orch", "auth", "claude", "default")
        const sourceOauthToken = path.join(sourceClaudeDefault, ".oauth-token")
        const sourceDebugDir = path.join(sourceClaudeDefault, "debug")
        const sourceBrokenDebugLink = path.join(sourceDebugDir, "latest")
        const targetOauthToken = path.join(outDir, ".orch", "auth", "claude", "default", ".oauth-token")
        const targetBrokenDebugLink = path.join(outDir, ".orch", "auth", "claude", "default", "debug", "latest")

        yield* _(fs.makeDirectory(sourceDebugDir, { recursive: true }))
        yield* _(fs.writeFileString(sourceOauthToken, "oauth-token\n"))
        const linkExitCode = yield* _(
          runCommandExitCode({
            cwd: root,
            command: "ln",
            args: ["-s", "/missing/claude-debug.txt", sourceBrokenDebugLink]
          })
        )
        expect(linkExitCode).toBe(0)

        yield* _(
          prepareProjectFiles(outDir, root, globalConfig, projectConfig, {
            force: false,
            forceEnv: false
          })
        )

        const synchronizedOauthToken = yield* _(fs.readFileString(targetOauthToken))
        const hasBrokenDebugLink = yield* _(fs.exists(targetBrokenDebugLink))
        expect(synchronizedOauthToken).toBe("oauth-token\n")
        expect(hasBrokenDebugLink).toBe(false)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
