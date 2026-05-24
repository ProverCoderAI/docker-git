/* jscpd:ignore-start */
import type { TemplateConfig } from "./domain.js"
import type { ResolvedComposeResourceLimits } from "./resource-limits.js"
import { renderEntrypoint } from "./templates-entrypoint.js"
import {
  type ComposeResourceLimits,
  type DockerComposeRenderOptions,
  renderDockerCompose
} from "./templates/docker-compose.js"
import { renderDockerfile } from "./templates/dockerfile.js"

// NOTE (Rust migration #347):
// The unified single-browser (noVNC + CDP) is now managed by the Rust binary
// `docker-git-browser-connection` (separate repo ProverCoderAI/rust-browser-connection).
// It guarantees exactly one `dg-{project}-browser` container per project.
// Legacy TS/shell browser runtime files have been replaced to avoid duplication.
// The Rust lifecycle CLI is started in background from entrypoint (see renderEntrypointRustBrowserConnection).
// MCP clients use the Rust `browser-connection` stdio server for the same shared browser container.

export type FileSpec =
  | { readonly _tag: "File"; readonly relativePath: string; readonly contents: string; readonly mode?: number }
  | { readonly _tag: "Dir"; readonly relativePath: string }

export type TemplateRenderOptions = {
  readonly compose: DockerComposeRenderOptions
}

const defaultTemplateRenderOptions: TemplateRenderOptions = {
  compose: { enableLocalDockerSocket: false }
}

const renderGitignore = (): string =>
  `# docker-git project files
# NOTE: bootstrap secrets stay local-only and should not be committed.

# docker-git scripts/tools (scripts plus local session-sync fallback)
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
  composeResourceLimits?: ResolvedComposeResourceLimits | ComposeResourceLimits,
  options: TemplateRenderOptions = defaultTemplateRenderOptions
): ReadonlyArray<FileSpec> => {
  // Old separate browser files removed — unified browser is provided by Rust module
  // (started via background task in entrypoint.sh).
  // No more duplication with packages/browser-connection or playwright-browser TS.
  const maybePlaywrightFiles: ReadonlyArray<FileSpec> = []

  return [
    { _tag: "File", relativePath: "Dockerfile", contents: renderDockerfile(config) },
    { _tag: "File", relativePath: "entrypoint.sh", contents: renderEntrypoint(config), mode: 0o755 },
    {
      _tag: "File",
      relativePath: "docker-compose.yml",
      contents: renderDockerCompose(config, composeResourceLimits, options.compose)
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
/* jscpd:ignore-end */
