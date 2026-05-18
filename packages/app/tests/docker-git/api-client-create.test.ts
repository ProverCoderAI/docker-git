import { describe, expect, it } from "@effect/vitest"

import { buildCreateProjectRequest } from "../../src/docker-git/api-client-create.js"
import { type CreateCommand, defaultTemplateConfig } from "../../src/docker-git/frontend-lib/core/domain.js"

const createCommand = (): CreateCommand => ({
  _tag: "Create",
  config: {
    ...defaultTemplateConfig,
    cpuLimit: "2",
    repoUrl: "https://github.com/org/repo.git",
    ramLimit: "4g",
    playwrightCpuLimit: "0.5",
    playwrightRamLimit: "1g"
  },
  force: false,
  forceEnv: false,
  openSsh: false,
  outDir: "/home/dev/project",
  runUp: true,
  waitForClone: true
})

describe("buildCreateProjectRequest", () => {
  it("includes dedicated Playwright resource limits", () => {
    const request = buildCreateProjectRequest(
      createCommand(),
      {
        authorizedKeysPath: "/home/dev/project/authorized_keys"
      }
    )

    expect(request.cpuLimit).toBe("2")
    expect(request.ramLimit).toBe("4g")
    expect(request.playwrightCpuLimit).toBe("0.5")
    expect(request.playwrightRamLimit).toBe("1g")
  })
})
