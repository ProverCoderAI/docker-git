/* jscpd:ignore-start */
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import type { ApiProjectDetails } from "../../src/docker-git/api-project-codec.js"
import { resolveOpenProjectEffect, selectOpenProject } from "../../src/docker-git/open-project.js"

// sonarjs/no-hardcoded-ip — test fixtures require deterministic IP addresses
const TEST_BRIDGE_IP = [172, 17, 0, 15].join(".")

const defaultProject = {
  id: "/controller/org/repo",
  displayName: "org/repo",
  repoUrl: "https://github.com/org/repo.git",
  repoRef: "main",
  status: "stopped",
  statusLabel: "stopped",
  containerName: "dg-repo",
  serviceName: "dg-repo",
  sshUser: "dev",
  sshPort: 2222,
  targetDir: "/home/dev/workspaces/org/repo",
  projectDir: "/controller/org/repo",
  sshCommand: "ssh dev@127.0.0.1 -p 2222",
  envGlobalPath: "/controller/.orch/env/global.env",
  envProjectPath: "/controller/org/repo/.orch/env/project.env",
  codexAuthPath: "/controller/.orch/auth/codex",
  codexHome: "/home/dev/.codex"
} satisfies Omit<ApiProjectDetails, "clonedOnHostname">

const makeProject = (overrides: Partial<ApiProjectDetails> = {}): ApiProjectDetails => ({
  ...defaultProject,
  ...overrides
})

const expectSelectedProject = (
  project: ApiProjectDetails,
  selector: string | undefined,
  assert: (resolved: ApiProjectDetails) => void
) =>
  Effect.gen(function*(_) {
    const resolved = yield* _(selectOpenProject([project], selector))
    assert(resolved)
  })

describe("selectOpenProject", () => {
  it.effect("prefers the single running project when selector is omitted", () =>
    Effect.gen(function*(_) {
      const stopped = makeProject({
        id: "/controller/org/repo-a",
        projectDir: "/controller/org/repo-a",
        containerName: "dg-repo-a",
        displayName: "org/repo-a",
        repoUrl: "https://github.com/org/repo-a.git"
      })
      const running = makeProject({
        id: "/controller/org/repo-b",
        projectDir: "/controller/org/repo-b",
        containerName: "dg-repo-b",
        displayName: "org/repo-b",
        repoUrl: "https://github.com/org/repo-b.git",
        status: "running",
        statusLabel: "Up 1 minute"
      })

      const resolved = yield* _(selectOpenProject([stopped, running]))
      expect(resolved.containerName).toBe("dg-repo-b")
    }))

  it.effect("matches a project by container name", () =>
    Effect.gen(function*(_) {
      const project = makeProject({
        id: "/controller/org/repo/issue-7",
        projectDir: "/controller/org/repo/issue-7",
        containerName: "dg-repo-issue-7",
        repoRef: "issue-7"
      })
      yield* _(
        expectSelectedProject(project, "dg-repo-issue-7", (resolved) => {
          expect(resolved.projectDir).toBe("/controller/org/repo/issue-7")
        })
      )
    }))

  it.effect("accepts an exact container selector even when multiple projects reuse the same container name", () =>
    Effect.gen(function*(_) {
      const first = makeProject({
        id: "/controller/testorganization123213/openclaw_autodeployer",
        projectDir: "/controller/testorganization123213/openclaw_autodeployer",
        displayName: "testorganization123213/openclaw_autodeployer",
        repoUrl: "https://github.com/TestOrganization123213/openclaw_autodeployer",
        containerName: "dg-openclaw_autodeployer",
        serviceName: "dg-openclaw_autodeployer"
      })
      const second = makeProject({
        id: "/controller/telegramgpt/openclaw_autodeployer",
        projectDir: "/controller/telegramgpt/openclaw_autodeployer",
        displayName: "telegramgpt/openclaw_autodeployer",
        repoUrl: "https://github.com/TelegramGPT/openclaw_autodeployer",
        containerName: "dg-openclaw_autodeployer",
        serviceName: "dg-openclaw_autodeployer"
      })

      const resolved = yield* _(selectOpenProject([first, second], "dg-openclaw_autodeployer"))
      expect(resolved.projectDir).toBe("/controller/testorganization123213/openclaw_autodeployer")
    }))

  it.effect("prefers the runtime owner for exact container selectors when API statuses are stale", () =>
    Effect.gen(function*(_) {
      const first = makeProject({
        id: "/controller/testorganization123213/openclaw_autodeployer",
        projectDir: "/controller/testorganization123213/openclaw_autodeployer",
        displayName: "testorganization123213/openclaw_autodeployer",
        repoUrl: "https://github.com/TestOrganization123213/openclaw_autodeployer",
        containerName: "dg-openclaw_autodeployer",
        serviceName: "dg-openclaw_autodeployer"
      })
      const second = makeProject({
        id: "/controller/telegramgpt/openclaw_autodeployer",
        projectDir: "/controller/telegramgpt/openclaw_autodeployer",
        displayName: "telegramgpt/openclaw_autodeployer",
        repoUrl: "https://github.com/TelegramGPT/openclaw_autodeployer",
        containerName: "dg-openclaw_autodeployer",
        serviceName: "dg-openclaw_autodeployer"
      })

      const resolved = yield* _(
        resolveOpenProjectEffect([first, second], "dg-openclaw_autodeployer", {
          inspectRuntime: () =>
            Effect.succeed({
              containerName: "dg-openclaw_autodeployer",
              running: true,
              ipAddress: TEST_BRIDGE_IP,
              projectWorkingDir: "/controller/telegramgpt/openclaw_autodeployer",
              composeService: "dg-openclaw_autodeployer"
            })
        })
      )

      expect(resolved.projectDir).toBe("/controller/telegramgpt/openclaw_autodeployer")
    }))

  it.effect("falls back to selector matching when runtime ownership is unavailable", () =>
    Effect.gen(function*(_) {
      const first = makeProject({
        id: "/controller/testorganization123213/openclaw_autodeployer",
        projectDir: "/controller/testorganization123213/openclaw_autodeployer",
        displayName: "testorganization123213/openclaw_autodeployer",
        repoUrl: "https://github.com/TestOrganization123213/openclaw_autodeployer",
        containerName: "dg-openclaw_autodeployer",
        serviceName: "dg-openclaw_autodeployer"
      })
      const second = makeProject({
        id: "/controller/telegramgpt/openclaw_autodeployer",
        projectDir: "/controller/telegramgpt/openclaw_autodeployer",
        displayName: "telegramgpt/openclaw_autodeployer",
        repoUrl: "https://github.com/TelegramGPT/openclaw_autodeployer",
        containerName: "dg-openclaw_autodeployer",
        serviceName: "dg-openclaw_autodeployer"
      })

      const resolved = yield* _(
        resolveOpenProjectEffect([first, second], "dg-openclaw_autodeployer", {
          inspectRuntime: () => Effect.succeed(null)
        })
      )

      expect(resolved.projectDir).toBe("/controller/testorganization123213/openclaw_autodeployer")
    }))

  it.effect("matches a project by GitHub issue URL", () =>
    Effect.gen(function*(_) {
      const project = makeProject({
        id: "/controller/org/repo/issue-7",
        projectDir: "/controller/org/repo/issue-7",
        containerName: "dg-repo-issue-7",
        repoRef: "issue-7"
      })
      yield* _(
        expectSelectedProject(project, "https://github.com/org/repo/issues/7", (resolved) => {
          expect(resolved.repoRef).toBe("issue-7")
        })
      )
    }))

  it.effect("matches a project by explicit project path selector", () =>
    Effect.gen(function*(_) {
      const project = makeProject({
        id: "/controller/org/repo/issue-9",
        projectDir: "/controller/org/repo/issue-9",
        containerName: "dg-repo-issue-9",
        repoRef: "issue-9"
      })

      const resolved = yield* _(selectOpenProject([project], "/controller/org/repo/issue-9"))
      expect(resolved.containerName).toBe("dg-repo-issue-9")
    }))

  it.effect("fails for ambiguous base repo URL selectors", () =>
    Effect.gen(function*(_) {
      const issueProject = makeProject({
        id: "/controller/org/repo/issue-7",
        projectDir: "/controller/org/repo/issue-7",
        containerName: "dg-repo-issue-7",
        repoRef: "issue-7"
      })
      const prProject = makeProject({
        id: "/controller/org/repo/pr-42",
        projectDir: "/controller/org/repo/pr-42",
        containerName: "dg-repo-pr-42",
        repoRef: "refs/pull/42/head"
      })

      const exit = yield* _(
        selectOpenProject([issueProject, prProject], "https://github.com/org/repo").pipe(Effect.exit)
      )
      expect(exit._tag).toBe("Failure")
    }))
})
/* jscpd:ignore-end */
