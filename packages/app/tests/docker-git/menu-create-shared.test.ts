import * as fc from "fast-check"
import { describe, expect, it } from "vitest"

import {
  advanceCreateFlow,
  createDisplayFlowView,
  createInitialFlowView,
  moveCreateSettingsStep,
  resolveCreateDisplaySteps,
  resolveCreateFlowSteps,
  resolveCreateSettingsChoiceBuffer
} from "../../src/docker-git/menu-create-shared.js"
import type { CreateInputs } from "../../src/docker-git/menu-types.js"
import {
  createFeatureRepoDisplaySettingsView,
  createFeatureRepoSettingsView,
  createFlowViewAtStep,
  expectCreateCompleteInputs,
  expectCreateContinueView,
  expectCreateNavigationResult,
  expectedOutDirForRepoUrl,
  expectedWrappedCreateNavigationStep,
  featureCreateRepoUrl,
  repositoryCreateInputArbitrary
} from "./create-flow-test-helpers.js"

const expectFeatureRepoDefaults = (
  value: {
    readonly outDir?: string
    readonly repoRef?: string
    readonly repoUrl?: string
  },
  defaultRoot: string
) => {
  expect(value.repoUrl).toBe(featureCreateRepoUrl)
  expect(value.repoRef).toBe("feature-x")
  expect(value.outDir).toBe(defaultRoot)
}

describe("menu-create-shared", () => {
  const cwd = process.cwd()
  const defaultRoot = `${process.env["HOME"] ?? cwd}/.docker-git/org/repo`
  const settingsDirectionArbitrary: fc.Arbitrary<"up" | "down"> = fc.constantFrom("up", "down")

  it("advances from repo URL into the wizard by default", () => {
    const view = expectCreateContinueView(advanceCreateFlow(
      cwd,
      createInitialFlowView(featureCreateRepoUrl)
    ))

    expect(view.step).toBe(1)
    expectFeatureRepoDefaults(view.values, defaultRoot)
    expect(view.values.runUp).toBeUndefined()
    expect(resolveCreateFlowSteps(view.values)).toEqual([
      "repoUrl",
      "cpuLimit",
      "ramLimit",
      "gpu",
      "runUp",
      "mcpPlaywright",
      "mcpAndroid",
      "force"
    ])
  })

  it("quick-creates from repo URL only when requested explicitly", () => {
    const inputs = expectCreateCompleteInputs(advanceCreateFlow(
      cwd,
      createInitialFlowView(featureCreateRepoUrl),
      { quickCreate: true }
    ))

    expectFeatureRepoDefaults(inputs, defaultRoot)
    expect(inputs.runUp).toBe(true)
  })

  it("prefills create values from inline CLI flags on the repo step", () => {
    const view = expectCreateContinueView(advanceCreateFlow(
      cwd,
      createInitialFlowView(`${featureCreateRepoUrl} --force --mcp-playwright --no-up`)
    ))

    expectFeatureRepoDefaults(view.values, defaultRoot)
    expect(view.values.force).toBe(true)
    expect(view.values.enableMcpPlaywright).toBe(true)
    expect(view.values.runUp).toBe(false)
    expect(resolveCreateFlowSteps(view.values)).toEqual([
      "repoUrl",
      "cpuLimit",
      "ramLimit",
      "gpu",
      "mcpAndroid"
    ])
  })

  it("preserves generated long out-dir buffers without recursion depth failures", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2500 }), (repeatCount) => {
        const longOutDir = `/tmp/${"nested-".repeat(repeatCount)}repo`
        const view = expectCreateContinueView(advanceCreateFlow(
          cwd,
          createInitialFlowView(`${featureCreateRepoUrl} --out-dir "${longOutDir}"`)
        ))

        expect(view.values.outDir).toBe(longOutDir)
      }),
      { numRuns: 25 }
    )
  })

  it("completes immediately when every remaining prompt was passed inline", () => {
    const inputs = expectCreateCompleteInputs(advanceCreateFlow(
      cwd,
      createInitialFlowView(
        `${featureCreateRepoUrl} --cpu 25% --ram 4g --gpu all --no-up --mcp-playwright --mcp-android --force`
      )
    ))

    expectFeatureRepoDefaults(inputs, defaultRoot)
    expect(inputs.cpuLimit).toBe("25%")
    expect(inputs.ramLimit).toBe("4g")
    expect(inputs.gpu).toBe("all")
    expect(inputs.runUp).toBe(false)
    expect(inputs.enableMcpPlaywright).toBe(true)
    expect(inputs.enableMcpAndroid).toBe(true)
    expect(inputs.force).toBe(true)
  })

  it("returns a parse error for invalid inline flags", () => {
    const next = advanceCreateFlow(
      cwd,
      createInitialFlowView("https://github.com/org/repo --bogus")
    )

    expect(next?._tag).toBe("Error")
    if (next === null || next._tag !== "Error") {
      return
    }

    expect(next.error).toEqual({
      _tag: "MissingOptionValue",
      option: "--bogus"
    })
  })

  it("uses server-provided projectsRoot in browser mode", () => {
    const view = expectCreateContinueView(advanceCreateFlow(
      {
        cwd: "/repo/packages/api",
        projectsRoot: "/home/dev/.docker-git"
      },
      createInitialFlowView(featureCreateRepoUrl)
    ))

    expect(view.values.outDir).toBe("/home/dev/.docker-git/org/repo")
  })

  it("preserves an absolute root projectsRoot in browser mode", () => {
    fc.assert(
      fc.property(repositoryCreateInputArbitrary, ({ repoUrl }) => {
        const view = expectCreateContinueView(advanceCreateFlow(
          {
            cwd: "/repo/packages/api",
            projectsRoot: "/"
          },
          createInitialFlowView(repoUrl)
        ))

        expect(view.values.outDir).toBe(expectedOutDirForRepoUrl(repoUrl, "/"))
        expect(view.values.outDir?.startsWith("/")).toBe(true)
      }),
      { numRuns: 50 }
    )
  })

  it("moves between remaining settings rows and clears the input buffer", () => {
    const view = createFeatureRepoSettingsView(cwd)
    const editingView = { ...view, buffer: "stale" }
    const lastStep = resolveCreateFlowSteps(view.values).length - 1

    const downView = moveCreateSettingsStep(editingView, "down")

    expect(downView).toEqual({
      ...view,
      step: 2,
      buffer: ""
    })

    const wrappedView = moveCreateSettingsStep(view, "up")

    expect(wrappedView).toEqual({
      ...view,
      step: lastStep,
      buffer: ""
    })
  })

  it("preserves settings navigation wraparound and buffer invariants", () => {
    const view = createFeatureRepoSettingsView(cwd)
    const lastStep = resolveCreateFlowSteps(view.values).length - 1

    fc.assert(
      fc.property(fc.integer({ min: 1, max: lastStep }), settingsDirectionArbitrary, (step, direction) => {
        const next = moveCreateSettingsStep({ ...view, step, buffer: "draft" }, direction)

        expectCreateNavigationResult(next, expectedWrappedCreateNavigationStep(step, direction, lastStep), view.values)
      })
    )
  })

  it("advances to the next remaining settings row after applying the current setting", () => {
    fc.assert(
      fc.property(fc.constantFrom("", "25%", "45%", "100m"), (cpuLimit) => {
        const next = expectCreateContinueView(advanceCreateFlow(
          cwd,
          {
            ...createFeatureRepoSettingsView(cwd),
            buffer: cpuLimit
          }
        ))

        expect(next.values.cpuLimit).toBe(cpuLimit)
        expect(next.step).toBe(1)
        expect(resolveCreateFlowSteps(next.values)[next.step]).toBe("ramLimit")
      })
    )
  })

  it("maps create-mode steps to the matching display row when opening browser Settings", () => {
    const creationView = {
      ...createFeatureRepoSettingsView(cwd),
      step: 1,
      values: {
        ...createFeatureRepoSettingsView(cwd).values,
        cpuLimit: "40%"
      }
    }
    const displayView = createDisplayFlowView(creationView)

    expect(resolveCreateFlowSteps(creationView.values)[creationView.step]).toBe("ramLimit")
    expect(resolveCreateDisplaySteps()[displayView.step]).toBe("ramLimit")
    expect(displayView.buffer).toBe(creationView.buffer)
    expect(displayView.values).toEqual(creationView.values)
  })

  it("does not navigate settings from the repo URL step", () => {
    expect(moveCreateSettingsStep(createInitialFlowView("https://github.com/org/repo"), "down")).toBeNull()
  })

  it("rejects settings navigation for every repo URL step buffer", () => {
    fc.assert(
      fc.property(fc.string(), (buffer) => {
        expect(moveCreateSettingsStep(createInitialFlowView(buffer), "down")).toBeNull()
        expect(moveCreateSettingsStep(createInitialFlowView(buffer), "up")).toBeNull()
      })
    )
  })

  it("resolves horizontal choices to buffer tokens for discrete settings rows", () => {
    const view = createFeatureRepoDisplaySettingsView(cwd)

    expect(resolveCreateSettingsChoiceBuffer(createFlowViewAtStep(view, "gpu"), "left")).toBe("none")
    expect(resolveCreateSettingsChoiceBuffer(createFlowViewAtStep(view, "gpu"), "right")).toBe("all")
    expect(resolveCreateSettingsChoiceBuffer(createFlowViewAtStep(view, "runUp"), "left")).toBe("n")
    expect(resolveCreateSettingsChoiceBuffer(createFlowViewAtStep(view, "runUp"), "right")).toBe("y")
    expect(resolveCreateSettingsChoiceBuffer(createFlowViewAtStep(view, "mcpPlaywright"), "left")).toBe("n")
    expect(resolveCreateSettingsChoiceBuffer(createFlowViewAtStep(view, "mcpPlaywright"), "right")).toBe("y")
    expect(resolveCreateSettingsChoiceBuffer(createFlowViewAtStep(view, "force"), "left")).toBe("n")
    expect(resolveCreateSettingsChoiceBuffer(createFlowViewAtStep(view, "force"), "right")).toBe("y")
  })

  it("does not resolve horizontal choices for free-text rows or unknown steps", () => {
    const view = createFeatureRepoDisplaySettingsView(cwd)
    const unknownStepView = {
      ...view,
      step: resolveCreateDisplaySteps().length + 1,
      buffer: "draft"
    }

    expect(resolveCreateSettingsChoiceBuffer(createFlowViewAtStep(view, "cpuLimit"), "left")).toBeNull()
    expect(resolveCreateSettingsChoiceBuffer(createFlowViewAtStep(view, "ramLimit"), "right")).toBeNull()
    expect(resolveCreateSettingsChoiceBuffer(unknownStepView, "left")).toBeNull()
  })

  it("completes after applying a navigated final setting with defaults", () => {
    const view = createFeatureRepoSettingsView(cwd)
    const forceView = moveCreateSettingsStep(view, "up")

    if (forceView === null) {
      throw new TypeError("expected settings navigation result")
    }

    const inputs = expectCreateCompleteInputs(advanceCreateFlow(
      cwd,
      {
        ...forceView,
        buffer: "y"
      }
    ))

    expect(inputs.force).toBe(true)
    expect(inputs.cpuLimit).toBe("")
    expect(inputs.ramLimit).toBe("")
  })

  it("completes after applying generated only remaining create settings", () => {
    const generatedSettingsArbitrary = fc.record({
      cpuLimit: fc.constantFrom("", "25%", "50%"),
      enableMcpPlaywright: fc.boolean(),
      enableMcpAndroid: fc.boolean(),
      force: fc.boolean(),
      gpu: fc.constantFrom<CreateInputs["gpu"]>("none", "all"),
      ramLimit: fc.constantFrom("", "2g", "4g"),
      runUp: fc.boolean()
    })
    fc.assert(
      fc.property(
        generatedSettingsArbitrary,
        ({ force, ...generatedValues }) => {
          const values = {
            outDir: defaultRoot,
            repoRef: "feature-x",
            repoUrl: featureCreateRepoUrl,
            ...generatedValues
          } satisfies Partial<CreateInputs>
          expect(resolveCreateFlowSteps(values)).toEqual(["repoUrl", "force"])

          const inputs = expectCreateCompleteInputs(advanceCreateFlow(
            cwd,
            {
              buffer: force ? "y" : "n",
              inputError: null,
              mode: "create",
              step: 1,
              values
            }
          ))

          expect(inputs.force).toBe(force)
        }
      ),
      { numRuns: 50 }
    )
  })
})
