import { Match } from "effect"

import {
  parseExplicitBooleanChoice,
  parseExplicitGpuChoice,
  renderExplicitBooleanChoice
} from "./menu-create-choices.js"
import type { CreateInputs, CreateStep } from "./menu-types.js"

export const renderCreateStepLabel = (step: CreateStep, defaults: CreateInputs): string =>
  Match.value(step).pipe(
    Match.when("repoUrl", () => "Repo URL (optional for empty workspace)"),
    Match.when("repoRef", () => `Repo ref [${defaults.repoRef}]`),
    Match.when("outDir", () => `Output dir [${defaults.outDir}]`),
    Match.when("cpuLimit", () => `CPU limit [${defaults.cpuLimit || "30%"}]`),
    Match.when("ramLimit", () => `RAM limit [${defaults.ramLimit || "30%"}]`),
    Match.when("gpu", () => `GPU access [${defaults.gpu}]`),
    Match.when("runUp", () => `Run docker compose up now? [${renderExplicitBooleanChoice(defaults.runUp)}]`),
    Match.when(
      "mcpPlaywright",
      () =>
        `Enable Playwright MCP (nested Chromium browser)? [${
          renderExplicitBooleanChoice(defaults.enableMcpPlaywright)
        }]`
    ),
    Match.when(
      "mcpAndroid",
      () => `Enable Android MCP (nested Android emulator)? [${renderExplicitBooleanChoice(defaults.enableMcpAndroid)}]`
    ),
    Match.when(
      "force",
      () => `Force recreate (overwrite files + wipe volumes)? [${renderExplicitBooleanChoice(defaults.force)}]`
    ),
    Match.exhaustive
  )

export const renderCreateStepLabelWithBufferPreview = (
  step: CreateStep,
  defaults: CreateInputs,
  buffer: string
): string =>
  Match.value(step).pipe(
    Match.when("repoUrl", () => renderCreateStepLabel(step, defaults)),
    Match.when("repoRef", () => renderCreateStepLabel(step, defaults)),
    Match.when("outDir", () => renderCreateStepLabel(step, defaults)),
    Match.when("cpuLimit", () => renderCreateStepLabel(step, defaults)),
    Match.when("ramLimit", () => renderCreateStepLabel(step, defaults)),
    Match.when("gpu", () => {
      const gpu = parseExplicitGpuChoice(buffer)
      return gpu === null ? renderCreateStepLabel(step, defaults) : `GPU access [${gpu}]`
    }),
    Match.when("runUp", () => {
      const runUp = parseExplicitBooleanChoice(buffer)
      return runUp === null
        ? renderCreateStepLabel(step, defaults)
        : `Run docker compose up now? [${renderExplicitBooleanChoice(runUp)}]`
    }),
    Match.when("mcpPlaywright", () => {
      const enableMcpPlaywright = parseExplicitBooleanChoice(buffer)
      return enableMcpPlaywright === null
        ? renderCreateStepLabel(step, defaults)
        : `Enable Playwright MCP (nested Chromium browser)? [${renderExplicitBooleanChoice(enableMcpPlaywright)}]`
    }),
    Match.when("mcpAndroid", () => {
      const enableMcpAndroid = parseExplicitBooleanChoice(buffer)
      return enableMcpAndroid === null
        ? renderCreateStepLabel(step, defaults)
        : `Enable Android MCP (nested Android emulator)? [${renderExplicitBooleanChoice(enableMcpAndroid)}]`
    }),
    Match.when("force", () => {
      const force = parseExplicitBooleanChoice(buffer)
      return force === null
        ? renderCreateStepLabel(step, defaults)
        : `Force recreate (overwrite files + wipe volumes)? [${renderExplicitBooleanChoice(force)}]`
    }),
    Match.exhaustive
  )
