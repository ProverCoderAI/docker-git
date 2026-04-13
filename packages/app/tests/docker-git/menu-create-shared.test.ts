import { describe, expect, it } from "vitest"

import { advanceCreateFlow, createInitialFlowView } from "../../src/docker-git/menu-create-shared.js"

const expectCompleteResult = (
  next: ReturnType<typeof advanceCreateFlow>
) => {
  expect(next?._tag).toBe("Complete")
  if (next === null || next._tag !== "Complete") {
    throw new TypeError("expected complete create flow result")
  }
  return next.inputs
}

describe("menu-create-shared", () => {
  const cwd = process.cwd()
  const defaultRoot = `${process.env["HOME"] ?? cwd}/.docker-git/org/repo`

  it("quick-creates from repo URL with derived defaults", () => {
    const inputs = expectCompleteResult(advanceCreateFlow(
      cwd,
      createInitialFlowView("https://github.com/org/repo/tree/feature-x")
    ))

    expect(inputs.repoUrl).toBe("https://github.com/org/repo/tree/feature-x")
    expect(inputs.repoRef).toBe("feature-x")
    expect(inputs.outDir).toBe(defaultRoot)
    expect(inputs.runUp).toBe(true)
  })

  it("keeps the advanced wizard when quick-create is overridden", () => {
    const next = advanceCreateFlow(
      cwd,
      createInitialFlowView("https://github.com/org/repo/tree/feature-x"),
      { forceWizard: true }
    )

    expect(next?._tag).toBe("Continue")
    if (next === null || next._tag !== "Continue") {
      return
    }

    expect(next.view.step).toBe(1)
    expect(next.view.values.repoUrl).toBe("https://github.com/org/repo/tree/feature-x")
    expect(next.view.values.outDir).toBe(defaultRoot)
  })

  it("uses server-provided projectsRoot in browser mode", () => {
    const inputs = expectCompleteResult(advanceCreateFlow(
      {
        cwd: "/repo/packages/api",
        projectsRoot: "/home/dev/.docker-git"
      },
      createInitialFlowView("https://github.com/org/repo/tree/feature-x")
    ))

    expect(inputs.outDir).toBe("/home/dev/.docker-git/org/repo")
  })
})
