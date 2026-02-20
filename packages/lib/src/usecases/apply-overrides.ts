import type { ApplyCommand, TemplateConfig } from "../core/domain.js"
import { normalizeAuthLabel, normalizeGitTokenLabel } from "../core/token-labels.js"

export const hasApplyOverrides = (command: ApplyCommand): boolean =>
  command.gitTokenLabel !== undefined ||
  command.codexTokenLabel !== undefined ||
  command.claudeTokenLabel !== undefined ||
  command.enableMcpPlaywright !== undefined

export const applyTemplateOverrides = (
  template: TemplateConfig,
  command: ApplyCommand | undefined
): TemplateConfig => {
  if (command === undefined) {
    return template
  }

  let nextTemplate = template

  if (command.gitTokenLabel !== undefined) {
    nextTemplate = {
      ...nextTemplate,
      gitTokenLabel: normalizeGitTokenLabel(command.gitTokenLabel)
    }
  }
  if (command.codexTokenLabel !== undefined) {
    nextTemplate = {
      ...nextTemplate,
      codexAuthLabel: normalizeAuthLabel(command.codexTokenLabel)
    }
  }
  if (command.claudeTokenLabel !== undefined) {
    nextTemplate = {
      ...nextTemplate,
      claudeAuthLabel: normalizeAuthLabel(command.claudeTokenLabel)
    }
  }
  if (command.enableMcpPlaywright !== undefined) {
    nextTemplate = {
      ...nextTemplate,
      enableMcpPlaywright: command.enableMcpPlaywright
    }
  }

  return nextTemplate
}
