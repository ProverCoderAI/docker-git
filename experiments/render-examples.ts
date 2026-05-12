import { defaultTemplateConfig, type TemplateConfig } from "../packages/lib/src/core/domain.ts"
import { renderClaudeGlobalPromptSetup } from "../packages/lib/src/core/templates-entrypoint/claude-extra-config.ts"
import { renderEntrypointAgentsNotice } from "../packages/lib/src/core/templates-entrypoint/agents-notice.ts"
import {
  renderEntrypointProjectCodexSkillsSync
} from "../packages/lib/src/core/templates-entrypoint/codex.ts"
import { renderEntrypointGeminiConfig } from "../packages/lib/src/core/templates-entrypoint/gemini.ts"

const cfg: TemplateConfig = {
  ...defaultTemplateConfig,
  repoUrl: "https://github.com/ProverCoderAI/docker-git.git",
  containerName: "dg-docker-git",
  serviceName: "dg-docker-git",
  sshUser: "dev",
  targetDir: "/home/dev/workspaces/ProverCoderAI/docker-git/issue-237",
  volumeName: "dg-docker-git-home",
  dockerGitPath: "/home/dev/.docker-git",
  authorizedKeysPath: "/home/dev/.docker-git/authorized_keys",
  envGlobalPath: "/home/dev/.docker-git/.orch/env/global.env",
  envProjectPath: "/home/dev/workspaces/ProverCoderAI/docker-git/issue-237/.orch/env/project.env",
  codexAuthPath: "/home/dev/.docker-git/.orch/auth/codex",
  codexSharedAuthPath: "/home/dev/.docker-git/.orch/auth/codex-shared",
  geminiAuthPath: "/home/dev/.docker-git/.orch/auth/gemini",
  repoRef: "issue-237"
}

import { writeFileSync } from "node:fs"

const banner = (title: string): string =>
  `\n${"=".repeat(80)}\n${title}\n${"=".repeat(80)}\n`

const output = [
  banner("CLAUDE.md prompt setup (~/.claude/CLAUDE.md)"),
  renderClaudeGlobalPromptSetup(cfg),
  banner(".codex/AGENTS.md prompt setup"),
  renderEntrypointAgentsNotice(cfg),
  banner("GEMINI.md prompt setup (full Gemini config block)"),
  renderEntrypointGeminiConfig(cfg),
  banner("Codex project skills sync (with CODEX_EXTRA_SKILLS_PATHS support)"),
  renderEntrypointProjectCodexSkillsSync(cfg)
].join("\n")

writeFileSync("experiments/render-examples-output.txt", output)
console.log(`Wrote ${output.length} bytes to experiments/render-examples-output.txt`)
