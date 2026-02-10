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

      expect(composeSpec !== undefined && composeSpec._tag === "File").toBe(true)
      expect(ignoreSpec !== undefined && ignoreSpec._tag === "File").toBe(true)
      expect(configSpec !== undefined && configSpec._tag === "File").toBe(true)
      expect(dockerfileSpec !== undefined && dockerfileSpec._tag === "File").toBe(true)

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
    }))
})
