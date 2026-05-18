import { describe, expect, it } from "@effect/vitest"

import {
  resolveComposeResourceLimits,
  resolvePlaywrightComposeResourceLimits,
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
    expect(resolved.playwrightCpuLimit).toBe("30%")
    expect(resolved.playwrightRamLimit).toBe("30%")
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

  it("preserves explicit playwright intent independently of main", () => {
    const resolved = withDefaultResourceLimitIntent({
      ...makeTemplate(),
      cpuLimit: "1.25",
      ramLimit: "3g",
      playwrightCpuLimit: "0.5",
      playwrightRamLimit: "1g"
    })

    expect(resolved.playwrightCpuLimit).toBe("0.5")
    expect(resolved.playwrightRamLimit).toBe("1g")
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
    expect(resolved.swapLimit).toBe("9830m")
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
    expect(resolved.swapLimit).toBe("1024m")
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
    expect(resolved.swapLimit).toBe("6144m")
  })
})

describe("resolvePlaywrightComposeResourceLimits", () => {
  it("uses dedicated playwright intent when provided", () => {
    const resolved = resolvePlaywrightComposeResourceLimits(
      {
        cpuLimit: "2",
        ramLimit: "4g",
        playwrightCpuLimit: "0.5",
        playwrightRamLimit: "1g"
      },
      {
        cpuCount: 8,
        totalMemoryBytes: 16 * 1024 ** 3
      }
    )

    expect(resolved.cpuLimit).toBe(0.5)
    expect(resolved.ramLimit).toBe("1g")
    expect(resolved.swapLimit).toBe("2048m")
  })

  it("falls back to main intent when playwright intent is missing", () => {
    const resolved = resolvePlaywrightComposeResourceLimits(
      {
        cpuLimit: "1.5",
        ramLimit: "2g"
      },
      {
        cpuCount: 8,
        totalMemoryBytes: 16 * 1024 ** 3
      }
    )

    expect(resolved.cpuLimit).toBe(1.5)
    expect(resolved.ramLimit).toBe("2g")
    expect(resolved.swapLimit).toBe("4096m")
  })

  it("falls back to default 30% when neither playwright nor main intent is set", () => {
    const resolved = resolvePlaywrightComposeResourceLimits(
      {},
      {
        cpuCount: 8,
        totalMemoryBytes: 16 * 1024 ** 3
      }
    )

    expect(resolved.cpuLimit).toBe(2.4)
    expect(resolved.ramLimit).toBe("4915m")
    expect(resolved.swapLimit).toBe("9830m")
  })

  it("supports percent intent for playwright independently", () => {
    const resolved = resolvePlaywrightComposeResourceLimits(
      {
        cpuLimit: "60%",
        ramLimit: "60%",
        playwrightCpuLimit: "10%",
        playwrightRamLimit: "10%"
      },
      {
        cpuCount: 8,
        totalMemoryBytes: 16 * 1024 ** 3
      }
    )

    expect(resolved.cpuLimit).toBe(0.8)
    expect(resolved.ramLimit).toBe("1638m")
    expect(resolved.swapLimit).toBe("3276m")
  })
})
