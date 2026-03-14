import { describe, expect, it } from "@effect/vitest"

import {
  resolveComposeResourceLimits,
  withDefaultResourceLimitIntent
} from "../../src/core/resource-limits.js"
import { defaultTemplateConfig, type TemplateConfig } from "../../src/core/domain.js"

const makeTemplate = (): TemplateConfig => ({
  ...defaultTemplateConfig,
  repoUrl: "https://github.com/org/repo.git"
})

describe("withDefaultResourceLimitIntent", () => {
  it("fills missing limit intent with 30%", () => {
    const resolved = withDefaultResourceLimitIntent(makeTemplate())

    expect(resolved.cpuLimit).toBe("30%")
    expect(resolved.ramLimit).toBe("30%")
  })

  it("preserves explicit limit intent", () => {
    const resolved = withDefaultResourceLimitIntent({
      ...makeTemplate(),
      cpuLimit: "1.25",
      ramLimit: "3g"
    })

    expect(resolved.cpuLimit).toBe("1.25")
    expect(resolved.ramLimit).toBe("3g")
  })
})

describe("resolveComposeResourceLimits", () => {
  it("resolves percent intent against host capacity", () => {
    const resolved = resolveComposeResourceLimits(
      {
        cpuLimit: "30%",
        ramLimit: "30%"
      },
      {
        cpuCount: 8,
        totalMemoryBytes: 16 * 1024 ** 3
      }
    )

    expect(resolved.cpuLimit).toBe(2.4)
    expect(resolved.ramLimit).toBe("4915m")
  })

  it("applies minimum caps for small hosts", () => {
    const resolved = resolveComposeResourceLimits(
      {
        cpuLimit: "30%",
        ramLimit: "30%"
      },
      {
        cpuCount: 1,
        totalMemoryBytes: 1024 ** 3
      }
    )

    expect(resolved.cpuLimit).toBe(0.3)
    expect(resolved.ramLimit).toBe("512m")
  })

  it("keeps absolute intent as-is", () => {
    const resolved = resolveComposeResourceLimits(
      {
        cpuLimit: "1.25",
        ramLimit: "3g"
      },
      {
        cpuCount: 32,
        totalMemoryBytes: 64 * 1024 ** 3
      }
    )

    expect(resolved.cpuLimit).toBe(1.25)
    expect(resolved.ramLimit).toBe("3g")
  })
})
