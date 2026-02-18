import type { TemplateConfig } from "./domain.js"
import {
  renderEntrypointAuthorizedKeys,
  renderEntrypointBaseline,
  renderEntrypointDisableMotd,
  renderEntrypointDockerSocket,
  renderEntrypointHeader,
  renderEntrypointInputRc,
  renderEntrypointSshd,
  renderEntrypointZshShell,
  renderEntrypointZshUserRc
} from "./templates-entrypoint/base.js"
import { renderEntrypointClaudeConfig } from "./templates-entrypoint/claude.js"
import {
  renderEntrypointAgentsNotice,
  renderEntrypointCodexHome,
  renderEntrypointCodexResumeHint,
  renderEntrypointCodexSharedAuth,
  renderEntrypointMcpPlaywright
} from "./templates-entrypoint/codex.js"
import { renderEntrypointGitConfig, renderEntrypointGitHooks } from "./templates-entrypoint/git.js"
import { renderEntrypointDockerGitBootstrap } from "./templates-entrypoint/nested-docker-git.js"
import { renderEntrypointOpenCodeConfig } from "./templates-entrypoint/opencode.js"
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
    renderEntrypointAuthorizedKeys(config),
    renderEntrypointCodexHome(config),
    renderEntrypointCodexSharedAuth(config),
    renderEntrypointOpenCodeConfig(config),
    renderEntrypointDockerGitBootstrap(config),
    renderEntrypointMcpPlaywright(config),
    renderEntrypointZshShell(config),
    renderEntrypointZshUserRc(config),
    renderEntrypointPrompt(),
    renderEntrypointBashCompletion(),
    renderEntrypointBashHistory(),
    renderEntrypointInputRc(config),
    renderEntrypointZshConfig(),
    renderEntrypointCodexResumeHint(config),
    renderEntrypointAgentsNotice(config),
    renderEntrypointDockerSocket(config),
    renderEntrypointGitConfig(config),
    renderEntrypointClaudeConfig(config),
    renderEntrypointGitHooks(),
    renderEntrypointBackgroundTasks(config),
    renderEntrypointBaseline(),
    renderEntrypointDisableMotd(),
    renderEntrypointSshd()
  ].join("\n\n")
