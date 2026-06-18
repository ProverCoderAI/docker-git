import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "fast-check"

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

const hasOwnField = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key)
const optionalPlaywrightLimitArbitrary = fc.option(fc.string(), { nil: undefined })

describe("api create project request body", () => {
  it.effect("preserves async create invariants for arbitrary Playwright resource limits", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(
          optionalPlaywrightLimitArbitrary,
          optionalPlaywrightLimitArbitrary,
          (playwrightCpuLimit, playwrightRamLimit) => {
            const draft: CreateProjectRequestDraft = {
              ...projectDraft,
              playwrightCpuLimit,
              playwrightRamLimit
            }
            const body = createProjectAcceptedBody(draft)

            expect(body.async).toBe(true)
            expect(body.openSsh).toBe(false)
            expect(body.useManagedAuthorizedKeys).toBe(true)
            expect(hasOwnField(body, "playwrightCpuLimit")).toBe(playwrightCpuLimit !== undefined)
            expect(hasOwnField(body, "playwrightRamLimit")).toBe(playwrightRamLimit !== undefined)
            if (playwrightCpuLimit !== undefined) {
              expect(body.playwrightCpuLimit).toBe(playwrightCpuLimit)
            }
            if (playwrightRamLimit !== undefined) {
              expect(body.playwrightRamLimit).toBe(playwrightRamLimit)
            }
          }
        ),
        { numRuns: 50 }
      )
    }))

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
