import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import {
  buildSshCommand,
  resolveCodexAuthPath,
  resolveGlobalEnvPath,
  resolveOrchRoot,
  resolveProjectsRoot,
  resolveSecretsRoot
} from "../../src/server/core/domain.js"

describe("resolveProjectsRoot", () => {
  it.effect("uses env override", () =>
    Effect.sync(() => {
      const root = resolveProjectsRoot("/cwd", { DOCKER_GIT_PROJECTS_ROOT: "/tmp/root" })
      expect(root).toBe("/tmp/root")
    }))

  it.effect("falls back to cwd", () =>
    Effect.sync(() => {
      const root = resolveProjectsRoot("/cwd", {})
      expect(root).toBe("/cwd/.docker-git")
    }))

  it.effect("falls back to home", () =>
    Effect.sync(() => {
      const root = resolveProjectsRoot("/cwd", { HOME: "/home/me" })
      expect(root).toBe("/home/me/.docker-git")
    }))
})

describe("orch helpers", () => {
  it.effect("builds orch paths", () =>
    Effect.sync(() => {
      const root = "/root/.docker-git"
      expect(resolveOrchRoot(root)).toBe("/root/.docker-git/.orch")
      expect(resolveSecretsRoot(root)).toBe("/root/.docker-git/.orch")
      expect(resolveGlobalEnvPath(root)).toBe("/root/.docker-git/.orch/env/global.env")
      expect(resolveCodexAuthPath(root)).toBe("/root/.docker-git/.orch/auth/codex")
    }))
})

describe("buildSshCommand", () => {
  it.effect("builds with key", () =>
    Effect.sync(() => {
      const command = buildSshCommand({
        sshUser: "dev",
        sshHost: "localhost",
        sshPort: 2222,
        sshKeyPath: "/tmp/key"
      })
      expect(command).toContain("-i /tmp/key")
      expect(command).toContain("dev@localhost")
    }))

  it.effect("builds without key", () =>
    Effect.sync(() => {
      const command = buildSshCommand({
        sshUser: "dev",
        sshHost: "localhost",
        sshPort: 2222,
        sshKeyPath: null
      })
      expect(command).toBe(
        "ssh -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 2222 dev@localhost"
      )
    }))
})
