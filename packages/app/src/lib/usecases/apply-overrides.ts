/* jscpd:ignore-start */
import type { ApplyCommand, TemplateConfig } from "../core/domain.js"
import { normalizeAuthLabel, normalizeGitTokenLabel } from "../core/token-labels.js"

const applyOverrideKeys = [
  "gitTokenLabel",
  "codexTokenLabel",
  "claudeTokenLabel",
  "geminiTokenLabel",
  "grokTokenLabel",
  "cpuLimit",
  "ramLimit",
  "playwrightCpuLimit",
  "playwrightRamLimit",
  "gpu",
  "enableMcpPlaywright"
] satisfies ReadonlyArray<keyof ApplyCommand>

export const hasApplyOverrides = (command: ApplyCommand): boolean =>
  applyOverrideKeys.some((key) => command[key] !== undefined)

const applyTokenOverrides = (template: TemplateConfig, command: ApplyCommand): TemplateConfig => {
  let next = template
  if (command.gitTokenLabel !== undefined) {
    next = { ...next, gitTokenLabel: normalizeGitTokenLabel(command.gitTokenLabel) }
  }
  if (command.codexTokenLabel !== undefined) {
    next = { ...next, codexAuthLabel: normalizeAuthLabel(command.codexTokenLabel) }
  }
  if (command.claudeTokenLabel !== undefined) {
    next = { ...next, claudeAuthLabel: normalizeAuthLabel(command.claudeTokenLabel) }
  }
  if (command.geminiTokenLabel !== undefined) {
    next = { ...next, geminiAuthLabel: normalizeAuthLabel(command.geminiTokenLabel) }
  }
  if (command.grokTokenLabel !== undefined) {
    next = { ...next, grokAuthLabel: normalizeAuthLabel(command.grokTokenLabel) }
  }
  return next
}

const applyResourceOverrides = (template: TemplateConfig, command: ApplyCommand): TemplateConfig => {
  let next = template
  if (command.cpuLimit !== undefined) {
    next = { ...next, cpuLimit: command.cpuLimit }
  }
  if (command.ramLimit !== undefined) {
    next = { ...next, ramLimit: command.ramLimit }
  }
  if (command.playwrightCpuLimit !== undefined) {
    next = { ...next, playwrightCpuLimit: command.playwrightCpuLimit }
  }
  if (command.playwrightRamLimit !== undefined) {
    next = { ...next, playwrightRamLimit: command.playwrightRamLimit }
  }
  if (command.gpu !== undefined) {
    next = { ...next, gpu: command.gpu }
  }
  if (command.enableMcpPlaywright !== undefined) {
    next = { ...next, enableMcpPlaywright: command.enableMcpPlaywright }
  }
  return next
}

export const applyTemplateOverrides = (
  template: TemplateConfig,
  command: ApplyCommand | undefined
): TemplateConfig => {
  if (command === undefined) {
    return template
  }
  return applyResourceOverrides(applyTokenOverrides(template, command), command)
}
/* jscpd:ignore-end */
