import * as fc from "fast-check"
import { createElement, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import {
  type CreateFlowContext,
  type CreateFlowView,
  createInitialFlowView,
  type CreateModeFlowView,
  createSettingsHint,
  type DisplayModeFlowView,
  renderCreateStepLabel,
  resolveCreateDisplaySteps,
  resolveCreateFlowSteps,
  resolveCreateInputs
} from "../../src/docker-git/menu-create-shared.js"
import { renderCreate } from "../../src/docker-git/menu-render.js"
import { webPrimitives } from "../../src/ui/primitives-web.js"
import { UiProvider } from "../../src/ui/primitives.js"
import { CreatePanel } from "../../src/web/panel-create-select.js"
import {
  createFeatureRepoDisplaySettingsView,
  createFeatureRepoSettingsView,
  createFlowViewAtStep,
  featureCreateRepoUrl
} from "./create-flow-test-helpers.js"

const createContext: CreateFlowContext = {
  cwd: "/workspace",
  projectsRoot: "/home/dev/.docker-git"
}

const renderWithUi = (element: ReactElement): string =>
  renderToStaticMarkup(createElement(UiProvider, { primitives: webPrimitives }, element))

const webCreateSettingsChoiceHint = "←/→ - choose yes/no or GPU"
const createSettingsView = (): DisplayModeFlowView => createFeatureRepoDisplaySettingsView(createContext)

const renderCreatePanel = (
  createView: CreateFlowView,
  options: { readonly compact?: boolean } = {}
): string =>
  renderWithUi(createElement(CreatePanel, {
    compact: options.compact ?? false,
    controllerCwd: createContext.cwd,
    createView,
    onBufferChange: vi.fn(),
    onCancel: vi.fn(),
    onSubmit: vi.fn(),
    projectsRoot: createContext.projectsRoot ?? ""
  }))

const activeStepMarker = "&gt; "

const countActiveStepMarkers = (html: string): number => html.split(activeStepMarker).length - 1

const renderStepLabels = (createView: CreateFlowView): ReadonlyArray<string> => {
  const defaults = resolveCreateInputs(createContext, createView.values)
  return resolveCreateDisplaySteps(createView.values).map((step) => renderCreateStepLabel(step, defaults))
}

const renderSettingsStepLabels = (createView: CreateFlowView): ReadonlyArray<string> => {
  const defaults = resolveCreateInputs(createContext, createView.values)
  return resolveCreateDisplaySteps(createView.values)
    .filter((step) => step !== "repoUrl")
    .map((step) => renderCreateStepLabel(step, defaults))
}

const createSettingsViewAtStep = (
  stepName: Parameters<typeof createFlowViewAtStep>[1],
  buffer: string
): CreateFlowView => createFlowViewAtStep(createSettingsView(), stepName, buffer)

const createTerminalSettingsView = (): CreateModeFlowView => createFeatureRepoSettingsView(createContext)

const renderTerminalCreate = (createView: CreateModeFlowView): string => {
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
    const html = renderCreatePanel(createInitialFlowView(featureCreateRepoUrl))
    const compactHtml = renderCreatePanel(createInitialFlowView(featureCreateRepoUrl), { compact: true })

    expect(html).toContain("Quick Create")
    expect(html).toContain("Settings")
    expect(html).not.toContain("Enter = next, Esc = cancel.")
    expect(html).not.toContain("Shift+Enter")
    expect(compactHtml).toContain("Quick Create")
    expect(compactHtml).toContain("Settings")
    expect(compactHtml).not.toContain("Enter = next, Esc = cancel.")
    expect(compactHtml).not.toContain("Shift+Enter")
  })

  it("renders repo URL inline errors in red", () => {
    const html = renderCreatePanel({
      ...createInitialFlowView(""),
      inputError: "Insert URL first"
    })

    expect(html).toContain("Insert URL first")
    expect(html).toContain("#ff6b6b")
  })

  it("omits repo URL inline errors when there is no error", () => {
    const html = renderCreatePanel(createInitialFlowView(""))

    expect(html).not.toContain("Insert URL first")
    expect(html).not.toContain("#ff6b6b")
  })

  it("does not render repo URL inline errors in Settings mode", () => {
    const html = renderCreatePanel({
      ...createSettingsView(),
      inputError: "Insert URL first"
    }, { compact: true })

    expect(html).not.toContain("Insert URL first")
  })

  it("keeps the compact repo URL step focused on the repo input and action buttons", () => {
    const createView = createInitialFlowView(featureCreateRepoUrl)
    const html = renderCreatePanel(createView, { compact: true })

    expect(html).toContain("Repo URL (optional for empty workspace)")
    expect(html).not.toContain(webCreateSettingsChoiceHint)
    for (const label of renderSettingsStepLabels(createView)) {
      expect(html).not.toContain(label)
    }
  })

  it("renders every create row in compact settings mode", () => {
    const createView = createSettingsView()
    const html = renderCreatePanel(createView, { compact: true })

    for (const label of renderStepLabels(createView)) {
      expect(html).toContain(label)
    }
  })

  it("keeps applied create rows visible with confirmed values", () => {
    const createView: CreateFlowView = {
      ...createSettingsViewAtStep("mcpPlaywright", ""),
      values: {
        ...createSettingsView().values,
        enableMcpPlaywright: true,
        force: true
      }
    }
    const html = renderCreatePanel(createView, { compact: true })

    expect(html).toContain("Enable Playwright MCP (nested Chromium browser)? [Y]")
    expect(html).toContain("Force recreate (overwrite files + wipe volumes)? [Y]")
    expect(html).toContain("CPU limit [30%]")
    expect(html).toContain("RAM limit [30%]")
    expect(html).toContain("GPU access [none]")
  })

  it("renders a final Done button in settings mode", () => {
    const html = renderCreatePanel(createSettingsView(), { compact: true })

    expect(html).toMatch(/<button[^>]*>Done<\/button>/u)
    expect(html).not.toContain("<button>Create</button>")
    expect(html).not.toContain("Quick Create")
    expect(html).not.toContain("Settings</button>")
  })

  it("marks only the current row active in compact settings mode", () => {
    const createView = createSettingsView()
    const html = renderCreatePanel(createView, { compact: true })
    const activeLabel = renderStepLabels(createView)[createView.step] ?? "Repo URL (optional for empty workspace)"

    expect(countActiveStepMarkers(html)).toBe(1)
    expect(html).toContain(`${activeStepMarker}${activeLabel}`)
  })

  it("previews side-arrow choices in the active settings row brackets without applying values", () => {
    const createView = createSettingsViewAtStep("mcpPlaywright", "y")
    const html = renderCreatePanel(createView, { compact: true })

    expect(html).toContain(`${activeStepMarker}Enable Playwright MCP (nested Chromium browser)? [Y]`)
    expect(html).toContain("Enable Playwright MCP (nested Chromium browser)? [Y]:")
    expect(html).toContain("Force recreate (overwrite files + wipe volumes)? [N]")
    expect(html).not.toContain(`${activeStepMarker}Enable Playwright MCP (nested Chromium browser)? [N]`)
  })

  it("drops unapplied bracket previews after settings navigation clears the buffer", () => {
    const createView = createSettingsViewAtStep("force", "")
    const html = renderCreatePanel(createView, { compact: true })

    expect(html).toContain(`${activeStepMarker}Force recreate (overwrite files + wipe volumes)? [N]`)
    expect(html).not.toContain("Force recreate (overwrite files + wipe volumes)? [Y]")
  })

  it("renders the settings navigation hint only after leaving the repo URL step", () => {
    expect(renderCreatePanel(createInitialFlowView(featureCreateRepoUrl))).not.toContain(createSettingsHint)
    expect(renderCreatePanel(createInitialFlowView(featureCreateRepoUrl))).not.toContain(webCreateSettingsChoiceHint)
    expect(renderCreatePanel(createSettingsView())).toContain(createSettingsHint)
    expect(renderCreatePanel(createSettingsView())).toContain(webCreateSettingsChoiceHint)
  })

  it("renders terminal Create hints with the same repo/settings split", () => {
    const repoHtml = renderTerminalCreate(createInitialFlowView(featureCreateRepoUrl))
    const settingsHtml = renderTerminalCreate(createTerminalSettingsView())

    expect(repoHtml).not.toContain("Enter = next, Esc = cancel.")
    expect(repoHtml).not.toContain("Shift+Enter")
    expect(settingsHtml).toContain(createSettingsHint)
    expect(settingsHtml).not.toContain(webCreateSettingsChoiceHint)
  })

  it("preserves hint visibility invariants for every Create step", () => {
    const settingsView = createSettingsView()
    const lastDisplayStep = resolveCreateDisplaySteps(settingsView.values).length - 1

    fc.assert(
      fc.property(fc.integer({ min: 0, max: lastDisplayStep }), (step) => {
        const view = step === 0 ? createInitialFlowView(featureCreateRepoUrl) : { ...settingsView, step }
        const isSettings = step > 0
        const panelHtml = renderCreatePanel(view)
        const compactPanelHtml = renderCreatePanel(view, { compact: true })

        expect(panelHtml.includes(createSettingsHint)).toBe(isSettings)
        expect(compactPanelHtml.includes(createSettingsHint)).toBe(isSettings)
        expect(panelHtml.includes(webCreateSettingsChoiceHint)).toBe(isSettings)
        expect(compactPanelHtml.includes(webCreateSettingsChoiceHint)).toBe(isSettings)
        expect(panelHtml).not.toContain("Enter = next, Esc = cancel.")
        expect(compactPanelHtml).not.toContain("Enter = next, Esc = cancel.")
        expect(panelHtml).not.toContain("Shift+Enter")
        expect(compactPanelHtml).not.toContain("Shift+Enter")
      })
    )

    const terminalSettingsView = createTerminalSettingsView()
    const lastTerminalStep = resolveCreateFlowSteps(terminalSettingsView.values).length - 1

    fc.assert(
      fc.property(fc.integer({ min: 0, max: lastTerminalStep }), (step) => {
        const view = step === 0 ? createInitialFlowView(featureCreateRepoUrl) : { ...terminalSettingsView, step }
        const terminalHtml = renderTerminalCreate(view)

        expect(terminalHtml.includes(createSettingsHint)).toBe(step > 0)
        expect(terminalHtml).not.toContain(webCreateSettingsChoiceHint)
        expect(terminalHtml).not.toContain("Enter = next, Esc = cancel.")
        expect(terminalHtml).not.toContain("Shift+Enter")
      })
    )
  })
})
