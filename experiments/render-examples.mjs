import { writeFileSync } from "node:fs"
import { defaultTemplateConfig } from "../packages/lib/dist/core/domain.js"
import { renderClaudeGlobalPromptSetup } from "../packages/lib/dist/core/templates-entrypoint/claude-extra-config.js"
import { renderEntrypointAgentsNotice } from "../packages/lib/dist/core/templates-entrypoint/agents-notice.js"
import { renderEntrypointProjectCodexSkillsSync } from "../packages/lib/dist/core/templates-entrypoint/codex.js"
import { renderEntrypointGeminiConfig } from "../packages/lib/dist/core/templates-entrypoint/gemini.js"

const cfg = {
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

const banner = (title) => `\n${"=".repeat(80)}\n${title}\n${"=".repeat(80)}\n`

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
console.log(`Wrote ${output.length} chars`)
