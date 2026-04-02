import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import type { ApiProjectDetails } from "../../src/docker-git/api-project-codec.js"
import { openResolvedProjectSshEffect, selectOpenProject } from "../../src/docker-git/open-project.js"
import { makeProjectItem } from "./fixtures/project-item.js"

const makeProject = (overrides?: Partial<ApiProjectDetails>): ApiProjectDetails => ({
  id: overrides?.id ?? "/controller/org/repo",
  displayName: overrides?.displayName ?? "org/repo",
  repoUrl: overrides?.repoUrl ?? "https://github.com/org/repo.git",
  repoRef: overrides?.repoRef ?? "main",
  status: overrides?.status ?? "stopped",
  statusLabel: overrides?.statusLabel ?? "stopped",
  containerName: overrides?.containerName ?? "dg-repo",
  serviceName: overrides?.serviceName ?? "dg-repo",
  sshUser: overrides?.sshUser ?? "dev",
  sshPort: overrides?.sshPort ?? 2222,
  targetDir: overrides?.targetDir ?? "/home/dev/workspaces/org/repo",
  projectDir: overrides?.projectDir ?? "/controller/org/repo",
  sshCommand: overrides?.sshCommand ?? "ssh dev@127.0.0.1 -p 2222",
  envGlobalPath: overrides?.envGlobalPath ?? "/controller/.orch/env/global.env",
  envProjectPath: overrides?.envProjectPath ?? "/controller/org/repo/.orch/env/project.env",
  codexAuthPath: overrides?.codexAuthPath ?? "/controller/.orch/auth/codex",
  codexHome: overrides?.codexHome ?? "/home/dev/.codex",
  clonedOnHostname: overrides?.clonedOnHostname
})

describe("selectOpenProject", () => {
  it.effect("uses the shared SSH-open effect ordering", () =>
    Effect.gen(function*(_) {
      const item = makeProjectItem({
        projectDir: "/controller/org/repo/issue-7",
        sshCommand: "ssh -p 22 dev@172.17.0.20"
      })
      const events: Array<string> = []

      yield* _(
        openResolvedProjectSshEffect(item, {
          log: (message) =>
            Effect.sync(() => {
              events.push(`log:${message}`)
            }),
          connectWithUp: (selected) =>
            Effect.sync(() => {
              events.push(`connect:${selected.projectDir}`)
            })
        })
      )

      expect(events).toEqual([
        "log:Opening SSH: ssh -p 22 dev@172.17.0.20",
        "connect:/controller/org/repo/issue-7"
      ])
    }))

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

      const resolved = yield* _(selectOpenProject([project], "dg-repo-issue-7"))
      expect(resolved.projectDir).toBe("/controller/org/repo/issue-7")
    }))

  it.effect("matches a project by GitHub issue URL", () =>
    Effect.gen(function*(_) {
      const project = makeProject({
        id: "/controller/org/repo/issue-7",
        projectDir: "/controller/org/repo/issue-7",
        containerName: "dg-repo-issue-7",
        repoRef: "issue-7"
      })

      const resolved = yield* _(selectOpenProject([project], "https://github.com/org/repo/issues/7"))
      expect(resolved.repoRef).toBe("issue-7")
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

      const exit = yield* _(selectOpenProject([issueProject, prProject], "https://github.com/org/repo").pipe(Effect.exit))
      expect(exit._tag).toBe("Failure")
    }))
})
