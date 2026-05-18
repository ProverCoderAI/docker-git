import * as fc from "fast-check"
import { createElement, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import {
  advanceCreateFlow,
  type CreateFlowContext,
  type CreateFlowView,
  createInitialFlowView,
  createSettingsHint,
  renderCreateStepLabel,
  resolveCreateFlowSteps,
  resolveCreateInputs
} from "../../src/docker-git/menu-create-shared.js"
import { renderCreate } from "../../src/docker-git/menu-render.js"
import { webPrimitives } from "../../src/ui/primitives-web.js"
import { UiProvider } from "../../src/ui/primitives.js"
import { CreatePanel } from "../../src/web/panel-create-select.js"

const createContext: CreateFlowContext = {
  cwd: "/workspace",
  projectsRoot: "/home/dev/.docker-git"
}

const renderWithUi = (element: ReactElement): string =>
  renderToStaticMarkup(createElement(UiProvider, { primitives: webPrimitives }, element))

const repoUrl = "https://github.com/org/repo/tree/feature-x"

const createSettingsView = (): CreateFlowView => {
  const next = advanceCreateFlow(createContext, createInitialFlowView(repoUrl))
  if (next === null || next._tag !== "Continue") {
    throw new TypeError("expected settings view")
  }
  return next.view
}

const renderCreatePanel = (createView: CreateFlowView): string =>
  renderWithUi(createElement(CreatePanel, {
    compact: false,
    controllerCwd: createContext.cwd,
    createView,
    onBufferChange: vi.fn(),
    onCancel: vi.fn(),
    onSubmit: vi.fn(),
    projectsRoot: createContext.projectsRoot ?? ""
  }))

const renderTerminalCreate = (createView: CreateFlowView): string => {
  const defaults = resolveCreateInputs(createContext, createView.values)
  const steps = resolveCreateFlowSteps(createView.values)
  const step = steps[createView.step] ?? "repoUrl"
  return renderWithUi(renderCreate({
    buffer: createView.buffer,
    defaults,
    label: renderCreateStepLabel(step, defaults),
    message: null,
    stepIndex: createView.step,
    steps
  }))
}

describe("Create flow rendering", () => {
  it("renders Quick Create and Settings on the repo URL step without the old micro-guide", () => {
    const html = renderCreatePanel(createInitialFlowView(repoUrl))

    expect(html).toContain("Quick Create")
    expect(html).toContain("Settings")
    expect(html).not.toContain("Enter = next, Esc = cancel.")
    expect(html).not.toContain("Shift+Enter")
  })

  it("renders the settings navigation hint only after leaving the repo URL step", () => {
    expect(renderCreatePanel(createInitialFlowView(repoUrl))).not.toContain(createSettingsHint)
    expect(renderCreatePanel(createSettingsView())).toContain(createSettingsHint)
  })

  it("renders terminal Create hints with the same repo/settings split", () => {
    const repoHtml = renderTerminalCreate(createInitialFlowView(repoUrl))
    const settingsHtml = renderTerminalCreate(createSettingsView())

    expect(repoHtml).not.toContain("Enter = next, Esc = cancel.")
    expect(repoHtml).not.toContain("Shift+Enter")
    expect(settingsHtml).toContain(createSettingsHint)
  })

  it("preserves hint visibility invariants for every Create step", () => {
    const settingsView = createSettingsView()
    const lastStep = resolveCreateFlowSteps(settingsView.values).length - 1

    fc.assert(
      fc.property(fc.integer({ min: 0, max: lastStep }), (step) => {
        const view = step === 0 ? createInitialFlowView(repoUrl) : { ...settingsView, step }
        const isSettings = step > 0
        const panelHtml = renderCreatePanel(view)
        const terminalHtml = renderTerminalCreate(view)

        expect(panelHtml.includes(createSettingsHint)).toBe(isSettings)
        expect(terminalHtml.includes(createSettingsHint)).toBe(isSettings)
        expect(panelHtml).not.toContain("Enter = next, Esc = cancel.")
        expect(terminalHtml).not.toContain("Enter = next, Esc = cancel.")
        expect(panelHtml).not.toContain("Shift+Enter")
        expect(terminalHtml).not.toContain("Shift+Enter")
      })
    )
  })
})
