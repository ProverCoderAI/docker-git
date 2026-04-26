import type { TemplateConfig } from "./domain.js"
import type { ResolvedComposeResourceLimits } from "./resource-limits.js"
import { renderEntrypoint } from "./templates-entrypoint.js"
import { renderDockerCompose } from "./templates/docker-compose.js"
import { renderDockerfile } from "./templates/dockerfile.js"
import { renderPlaywrightBrowserDockerfile, renderPlaywrightStartExtra } from "./templates/playwright.js"

export type FileSpec =
  | { readonly _tag: "File"; readonly relativePath: string; readonly contents: string; readonly mode?: number }
  | { readonly _tag: "Dir"; readonly relativePath: string }

const renderGitignore = (): string =>
  `# docker-git project files
# NOTE: bootstrap secrets stay local-only and should not be committed.

# docker-git scripts/tools (copied from workspace, rebuilt on each project update)
scripts/
.docker-git-tools/

# Volatile Codex artifacts (do not commit)
authorized_keys
.orch/auth/codex/auth.json
.orch/auth/claude/
.orch/auth/codex/log/
.orch/auth/codex/tmp/
.orch/auth/codex/sessions/
.orch/auth/codex/models_cache.json
`

const renderDockerignore = (): string =>
  `# docker-git build context
authorized_keys
.orch/env/
.orch/auth/codex/
.orch/auth/claude/
.orch/auth/codex/log/
.orch/auth/codex/tmp/
.orch/auth/codex/sessions/
.orch/auth/codex/models_cache.json
`

const renderConfigJson = (config: TemplateConfig): string =>
  `${JSON.stringify({ schemaVersion: 1, template: config }, null, 2)}
`

export const planFiles = (
  config: TemplateConfig,
  composeResourceLimits?: ResolvedComposeResourceLimits
): ReadonlyArray<FileSpec> => {
  const maybePlaywrightFiles = config.enableMcpPlaywright
    ? ([
      { _tag: "File", relativePath: "Dockerfile.browser", contents: renderPlaywrightBrowserDockerfile() },
      {
        _tag: "File",
        relativePath: "mcp-playwright-start-extra.sh",
        contents: renderPlaywrightStartExtra(),
        mode: 0o755
      }
    ] satisfies ReadonlyArray<FileSpec>)
    : ([] satisfies ReadonlyArray<FileSpec>)

  return [
    { _tag: "File", relativePath: "Dockerfile", contents: renderDockerfile(config) },
    { _tag: "File", relativePath: "entrypoint.sh", contents: renderEntrypoint(config), mode: 0o755 },
    {
      _tag: "File",
      relativePath: "docker-compose.yml",
      contents: renderDockerCompose(config, composeResourceLimits)
    },
    { _tag: "File", relativePath: ".dockerignore", contents: renderDockerignore() },
    { _tag: "File", relativePath: "docker-git.json", contents: renderConfigJson(config) },
    { _tag: "File", relativePath: ".gitignore", contents: renderGitignore() },
    ...maybePlaywrightFiles,
    { _tag: "Dir", relativePath: ".orch/auth/codex" },
    { _tag: "Dir", relativePath: ".orch/auth/claude" },
    { _tag: "Dir", relativePath: ".orch/env" }
  ]
}
