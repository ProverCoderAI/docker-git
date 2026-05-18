/* jscpd:ignore-start */
import type { TemplateConfig } from "./domain.js"
import { renderEntrypointAgentsNotice } from "./templates-entrypoint/agents-notice.js"
import {
  renderEntrypointAuthorizedKeys,
  renderEntrypointBaseline,
  renderEntrypointDisableMotd,
  renderEntrypointDockerSocket,
  renderEntrypointHeader,
  renderEntrypointInputRc,
  renderEntrypointPackageCache,
  renderEntrypointSshd,
  renderEntrypointZshShell,
  renderEntrypointZshUserRc
} from "./templates-entrypoint/base.js"
import { renderEntrypointClaudeConfig } from "./templates-entrypoint/claude.js"
import {
  renderEntrypointCodexHome,
  renderEntrypointCodexResumeHint,
  renderEntrypointCodexSharedAuth,
  renderEntrypointMcpPlaywright,
  renderEntrypointProjectCodexSkillsSync
} from "./templates-entrypoint/codex.js"
import { renderEntrypointDnsRepair } from "./templates-entrypoint/dns-repair.js"
import { renderEntrypointGeminiConfig } from "./templates-entrypoint/gemini.js"
import { renderEntrypointGitConfig, renderEntrypointGitHooks } from "./templates-entrypoint/git.js"
import { renderEntrypointGrokConfig } from "./templates-entrypoint/grok.js"
import { renderEntrypointDockerGitBootstrap } from "./templates-entrypoint/nested-docker-git.js"
import { renderEntrypointOpenCodeConfig } from "./templates-entrypoint/opencode.js"
import { renderEntrypointPlaywrightBrowserRuntime } from "./templates-entrypoint/playwright-browser.js"
import { renderEntrypointProjectAgentRules } from "./templates-entrypoint/project-rules.js"
import { renderEntrypointRtkConfig } from "./templates-entrypoint/rtk.js"
import { renderEntrypointBackgroundTasks } from "./templates-entrypoint/tasks.js"
import {
  renderEntrypointBashCompletion,
  renderEntrypointBashHistory,
  renderEntrypointPrompt,
  renderEntrypointZshConfig
} from "./templates-prompt.js"

export const renderEntrypoint = (config: TemplateConfig): string =>
  [
    renderEntrypointHeader(config),
    renderEntrypointDnsRepair(),
    renderEntrypointPackageCache(config),
    renderEntrypointDockerGitBootstrap(config),
    renderEntrypointAuthorizedKeys(config),
    renderEntrypointCodexHome(config),
    renderEntrypointCodexSharedAuth(config),
    renderEntrypointOpenCodeConfig(config),
    renderEntrypointZshShell(config),
    renderEntrypointZshUserRc(config),
    renderEntrypointPrompt(),
    renderEntrypointBashCompletion(),
    renderEntrypointBashHistory(),
    renderEntrypointInputRc(config),
    renderEntrypointZshConfig(),
    renderEntrypointCodexResumeHint(config),
    renderEntrypointProjectCodexSkillsSync(config),
    renderEntrypointProjectAgentRules(),
    renderEntrypointAgentsNotice(config),
    renderEntrypointDockerSocket(config),
    renderEntrypointPlaywrightBrowserRuntime(config),
    renderEntrypointMcpPlaywright(config),
    renderEntrypointGitConfig(config),
    renderEntrypointClaudeConfig(config),
    renderEntrypointGeminiConfig(config),
    renderEntrypointGrokConfig(config),
    renderEntrypointRtkConfig(config),
    renderEntrypointGitHooks(),
    renderEntrypointBackgroundTasks(config),
    renderEntrypointBaseline(),
    renderEntrypointDisableMotd(),
    renderEntrypointSshd()
  ].join("\n\n")
/* jscpd:ignore-end */
