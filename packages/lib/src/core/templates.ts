import type { TemplateConfig } from "./domain.js"
import { renderEntrypoint } from "./templates-entrypoint.js"
import { renderDockerCompose } from "./templates/docker-compose.js"
import { renderDockerfile } from "./templates/dockerfile.js"
import { renderPlaywrightBrowserDockerfile, renderPlaywrightStartExtra } from "./templates/playwright.js"

export type FileSpec =
  | { readonly _tag: "File"; readonly relativePath: string; readonly contents: string; readonly mode?: number }
  | { readonly _tag: "Dir"; readonly relativePath: string }

const renderGitignore = (): string =>
  `# docker-git project files
# NOTE: this directory is intended to be committed to the docker-git state repository.
# It intentionally does not ignore .orch/ or auth files; keep the state repo private.

# Volatile Codex artifacts (do not commit)
.orch/auth/codex/log/
.orch/auth/codex/tmp/
.orch/auth/codex/sessions/
.orch/auth/codex/models_cache.json
`

const renderDockerignore = (): string =>
  `# docker-git build context
.orch/
authorized_keys
`

const renderConfigJson = (config: TemplateConfig): string =>
  `${JSON.stringify({ schemaVersion: 1, template: config }, null, 2)}
`

export const planFiles = (config: TemplateConfig): ReadonlyArray<FileSpec> => {
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
    { _tag: "File", relativePath: "docker-compose.yml", contents: renderDockerCompose(config) },
    { _tag: "File", relativePath: ".dockerignore", contents: renderDockerignore() },
    { _tag: "File", relativePath: "docker-git.json", contents: renderConfigJson(config) },
    { _tag: "File", relativePath: ".gitignore", contents: renderGitignore() },
    ...maybePlaywrightFiles,
    { _tag: "Dir", relativePath: ".orch/auth/codex" },
    { _tag: "Dir", relativePath: ".orch/env" }
  ]
}
