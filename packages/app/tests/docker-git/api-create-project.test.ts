import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { createProjectAcceptedBody } from "../../src/web/api-create-project.js"
import type { CreateProjectRequestDraft } from "../../src/web/api-project-create-body.js"

const projectDraft = {
  cpuLimit: "80%",
  enableMcpPlaywright: true,
  force: false,
  forceEnv: false,
  gpu: "none",
  outDir: "/home/dev/.docker-git/octocat/hello-world",
  playwrightCpuLimit: "40%",
  playwrightRamLimit: "512m",
  ramLimit: "2g",
  repoRef: "main",
  repoUrl: "https://github.com/octocat/hello-world.git",
  up: true
} satisfies CreateProjectRequestDraft

describe("api create project request body", () => {
  it.effect("serializes async create requests with Playwright resource limits", () =>
    Effect.sync(() => {
      expect(createProjectAcceptedBody(projectDraft)).toEqual({
        async: true,
        cpuLimit: "80%",
        enableMcpPlaywright: true,
        force: false,
        forceEnv: false,
        gpu: "none",
        openSsh: false,
        outDir: "/home/dev/.docker-git/octocat/hello-world",
        playwrightCpuLimit: "40%",
        playwrightRamLimit: "512m",
        ramLimit: "2g",
        repoRef: "main",
        repoUrl: "https://github.com/octocat/hello-world.git",
        up: true,
        useManagedAuthorizedKeys: true
      })
    }))
})
