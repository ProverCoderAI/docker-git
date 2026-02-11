import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { planFiles } from "../../src/core/templates.js"
import { type TemplateConfig } from "../../src/core/domain.js"

describe("planFiles", () => {
  it.effect("includes docker and config files", () =>
    Effect.sync(() => {
      const config: TemplateConfig = {
        containerName: "dg-test",
        serviceName: "dg-test",
        sshUser: "dev",
        sshPort: 2222,
        repoUrl: "https://github.com/org/repo.git",
        repoRef: "main",
        targetDir: "/home/dev/app",
        volumeName: "dg-test-home",
        authorizedKeysPath: "./authorized_keys",
        envGlobalPath: "./.orch/env/global.env",
        envProjectPath: "./.orch/env/project.env",
        codexAuthPath: "./.orch/auth/codex",
        codexSharedAuthPath: "../../.orch/auth/codex",
        codexHome: "/home/dev/.codex",
        enableMcpPlaywright: false,
        pnpmVersion: "10.27.0"
      }

      const specs = planFiles(config)
      const composeSpec = specs.find(
        (spec) => spec._tag === "File" && spec.relativePath === "docker-compose.yml"
      )
      const ignoreSpec = specs.find(
        (spec) => spec._tag === "File" && spec.relativePath === ".dockerignore"
      )
      const configSpec = specs.find(
        (spec) => spec._tag === "File" && spec.relativePath === "docker-git.json"
      )
      const dockerfileSpec = specs.find(
        (spec) => spec._tag === "File" && spec.relativePath === "Dockerfile"
      )
      const entrypointSpec = specs.find(
        (spec) => spec._tag === "File" && spec.relativePath === "entrypoint.sh"
      )

      expect(composeSpec !== undefined && composeSpec._tag === "File").toBe(true)
      expect(ignoreSpec !== undefined && ignoreSpec._tag === "File").toBe(true)
      expect(configSpec !== undefined && configSpec._tag === "File").toBe(true)
      expect(dockerfileSpec !== undefined && dockerfileSpec._tag === "File").toBe(true)
      expect(entrypointSpec !== undefined && entrypointSpec._tag === "File").toBe(true)

      if (configSpec && configSpec._tag === "File") {
        expect(configSpec.contents).toContain(config.repoUrl)
        expect(configSpec.contents).toContain(config.containerName)
      }

      if (ignoreSpec && ignoreSpec._tag === "File") {
        expect(ignoreSpec.contents).toContain(".orch/")
        expect(ignoreSpec.contents).toContain("authorized_keys")
      }

      if (dockerfileSpec && dockerfileSpec._tag === "File") {
        expect(dockerfileSpec.contents).toContain("MENU_COMPLETE")
        expect(dockerfileSpec.contents).toContain("AUTO_MENU")
        expect(dockerfileSpec.contents).toContain("ncurses-term")
        expect(dockerfileSpec.contents).toContain("tag-order builtins commands")
      }

      if (entrypointSpec && entrypointSpec._tag === "File") {
        expect(entrypointSpec.contents).toContain("gh auth setup-git --hostname github.com --force")
        expect(entrypointSpec.contents).toContain("GIT_USER_EMAIL=\"${GH_ID}+${GH_LOGIN}@users.noreply.github.com\"")
      }
    }))

  it.effect("includes Playwright sidecar files when enabled", () =>
    Effect.sync(() => {
      const config: TemplateConfig = {
        containerName: "dg-test",
        serviceName: "dg-test",
        sshUser: "dev",
        sshPort: 2222,
        repoUrl: "https://github.com/org/repo.git",
        repoRef: "main",
        targetDir: "/home/dev/app",
        volumeName: "dg-test-home",
        authorizedKeysPath: "./authorized_keys",
        envGlobalPath: "./.orch/env/global.env",
        envProjectPath: "./.orch/env/project.env",
        codexAuthPath: "./.orch/auth/codex",
        codexSharedAuthPath: "../../.orch/auth/codex",
        codexHome: "/home/dev/.codex",
        enableMcpPlaywright: true,
        pnpmVersion: "10.27.0"
      }

      const specs = planFiles(config)
      const browserDockerfile = specs.find(
        (spec) => spec._tag === "File" && spec.relativePath === "Dockerfile.browser"
      )
      const browserScript = specs.find(
        (spec) => spec._tag === "File" && spec.relativePath === "mcp-playwright-start-extra.sh"
      )

      expect(browserDockerfile !== undefined && browserDockerfile._tag === "File").toBe(true)
      expect(browserScript !== undefined && browserScript._tag === "File").toBe(true)
    }))

  it.effect("embeds issue workspace AGENTS context in entrypoint", () =>
    Effect.sync(() => {
      const config: TemplateConfig = {
        containerName: "dg-repo-issue-5",
        serviceName: "dg-repo-issue-5",
        sshUser: "dev",
        sshPort: 2222,
        repoUrl: "https://github.com/org/repo.git",
        repoRef: "issue-5",
        targetDir: "/home/dev/org/repo/issue-5",
        volumeName: "dg-repo-issue-5-home",
        authorizedKeysPath: "./authorized_keys",
        envGlobalPath: "./.orch/env/global.env",
        envProjectPath: "./.orch/env/project.env",
        codexAuthPath: "./.orch/auth/codex",
        codexSharedAuthPath: "../../.orch/auth/codex",
        codexHome: "/home/dev/.codex",
        enableMcpPlaywright: false,
        pnpmVersion: "10.27.0"
      }

      const specs = planFiles(config)
      const entrypointSpec = specs.find(
        (spec) => spec._tag === "File" && spec.relativePath === "entrypoint.sh"
      )
      expect(entrypointSpec !== undefined && entrypointSpec._tag === "File").toBe(true)
      if (entrypointSpec && entrypointSpec._tag === "File") {
        expect(entrypointSpec.contents).toContain("Доступные workspace пути:")
        expect(entrypointSpec.contents).toContain("Контекст workspace:")
        expect(entrypointSpec.contents).toContain("Issue AGENTS.md:")
        expect(entrypointSpec.contents).toContain("ISSUE_AGENTS_PATH=\"$TARGET_DIR/AGENTS.md\"")
        expect(entrypointSpec.contents).toContain("grep -qx \"AGENTS.md\" \"$EXCLUDE_PATH\"")
      }
    }))
})
