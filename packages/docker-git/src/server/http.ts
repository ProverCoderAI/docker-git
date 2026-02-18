import { Console, Effect, pipe, Either, Chunk, Ref, Duration } from "effect"
import * as Stream from "effect/Stream"
import type { PlatformError } from "@effect/platform/Error"
import type * as HttpBody from "@effect/platform/HttpBody"
import * as HttpRouter from "@effect/platform/HttpRouter"
import * as HttpServerRequest from "@effect/platform/HttpServerRequest"
import * as HttpServerResponse from "@effect/platform/HttpServerResponse"
import * as HttpServerError from "@effect/platform/HttpServerError"
import * as FileSystem from "@effect/platform/FileSystem"
import * as ParseResult from "effect/ParseResult"
import * as Schema from "effect/Schema"
import * as Path from "@effect/platform/Path"

import {
  type ConfigDecodeError,
  type ConfigNotFoundError,
  CloneFailedError,
  FileExistsError,
  PortProbeError
} from "../shell/errors.js"
import { DockerCommandError } from "../shell/errors.js"
import { readProjectConfig } from "../shell/config.js"
import { ProjectNotFoundError, StaticAssetNotFoundError } from "./errors.js"
import { ProjectParamsSchema } from "./core/schema.js"
import { resolveCodexAuthPath, resolveGlobalEnvPath } from "./core/domain.js"
import { parseEnvEntries, upsertEnvKey } from "./core/env.js"
import { loadProject, scanProjects } from "./projects.js"
import { readDockerComposeLogs, readDockerComposePs } from "./docker.js"
import { readEnvFile, writeEnvFile } from "./env.js"
import {
  appendDeploymentLog,
  clearDeploymentLogs,
  getDeploymentStatus,
  isDeploymentActive,
  listDeploymentLogs,
  listDeploymentStatuses,
  markDeploymentActive,
  markDeploymentInactive,
  setDeploymentStatus
} from "./deployments.js"
import { runComposeWithStatus } from "./compose.js"
import {
  renderCodexLoginPage,
  renderClonePage,
  renderDashboard,
  renderEnvPage,
  renderGithubTokenHelpPage,
  renderIntegrationsPage,
  renderDeployLogsPage,
  renderOutputPage,
  renderTerminalPage
} from "./view.js"
import {
  buildGithubTokenKey,
  findGithubTokenByLabel,
  listGithubTokens,
  projectGithubLabelKey,
  resolveProjectGithubLabel,
  resolveProjectGithubToken
} from "./github.js"
import {
  findGitCredentialByLabel,
  projectGitLabelKey,
  resolveProjectGitLabel,
  resolveProjectGitToken
} from "./git-credentials.js"
import {
  findClaudeApiKeyByLabel,
  projectClaudeLabelKey,
  resolveProjectClaudeApiKey,
  resolveProjectClaudeLabel
} from "./claude.js"
import { buildLabeledEnvKey } from "./labeled-env.js"
import { createProject } from "@effect-template/lib/usecases/actions"
import { buildCreateCommand } from "@effect-template/lib/core/command-builders"
import type { RawOptions } from "@effect-template/lib/core/command-options"
import type { DockerAccessError as LibDockerAccessError } from "@effect-template/lib/shell/errors"
import { defaultTemplateConfig, deriveRepoSlug } from "../core/domain.js"
import { formatParseError } from "@effect-template/lib/core/parse-errors"
import {
  CodexAuthError,
  clearCodexAuthDir,
  copyCodexAuthDir,
  findCodexAccountPath,
  importCodexAuthDir,
  listCodexAccounts,
  readCodexAuthStatus,
  removeCodexAccount,
  resolveCodexSourcePath,
  resolveProjectCodexAuthPath,
  resolveWritableCodexRoot,
  resolveProjectCodexLabel
} from "./codex.js"
import { findAvailablePort, type PortRange } from "./core/ports.js"

export interface ServerPaths {
  readonly cwd: string
  readonly projectsRoot: string
  readonly webRoot: string
  readonly vendorRoot: string
  readonly terminalPort: number
}

type ApiError =
  | ProjectNotFoundError
  | StaticAssetNotFoundError
  | ConfigNotFoundError
  | ConfigDecodeError
  | FileExistsError
  | CloneFailedError
  | PortProbeError
  | DockerCommandError
  | LibDockerAccessError
  | CodexAuthError
  | ParseResult.ParseError
  | HttpBody.HttpBodyError
  | HttpServerError.RequestError
  | PlatformError

const EnvFormSchema = Schema.Struct({
  globalEnv: Schema.String,
  projectEnv: Schema.String
})

const GithubConnectSchema = Schema.Struct({
  githubToken: Schema.String,
  githubLabel: Schema.optional(Schema.String)
})

const GithubDisconnectSchema = Schema.Struct({
  githubLabel: Schema.optional(Schema.String)
})

const GithubProjectConnectSchema = Schema.Struct({
  githubLabel: Schema.String
})

const GithubProjectDisconnectSchema = Schema.Struct({})

const GitConnectSchema = Schema.Struct({
  gitToken: Schema.String,
  gitUser: Schema.optional(Schema.String),
  gitLabel: Schema.optional(Schema.String)
})

const GitDisconnectSchema = Schema.Struct({
  gitLabel: Schema.optional(Schema.String)
})

const GitProjectConnectSchema = Schema.Struct({
  gitLabel: Schema.String
})

const GitProjectDisconnectSchema = Schema.Struct({})

const ClaudeConnectSchema = Schema.Struct({
  claudeApiKey: Schema.String,
  claudeLabel: Schema.optional(Schema.String)
})

const ClaudeDisconnectSchema = Schema.Struct({
  claudeLabel: Schema.optional(Schema.String)
})

const ClaudeProjectConnectSchema = Schema.Struct({
  claudeLabel: Schema.String
})

const ClaudeProjectDisconnectSchema = Schema.Struct({})

const CodexConnectSchema = Schema.Struct({
  codexSource: Schema.optional(Schema.String),
  codexLabel: Schema.optional(Schema.String)
})
const CodexCliLoginSchema = Schema.Struct({
  codexLabel: Schema.optional(Schema.String)
})

const CodexProjectConnectSchema = Schema.Struct({
  codexLabel: Schema.String
})

const CodexProjectDisconnectSchema = Schema.Struct({})

const CloneFormSchema = Schema.Struct({
  repoUrl: Schema.String,
  repoRef: Schema.optional(Schema.String),
  githubLabel: Schema.optional(Schema.String)
})

const GitIdentitySchema = Schema.Struct({
  gitUserName: Schema.String,
  gitUserEmail: Schema.String
})

const sshPortRange: PortRange = { min: 2222, max: 2299 }

const chooseSshPort = (
  preferred: number,
  usedPorts: ReadonlyArray<number>
): number =>
  findAvailablePort(preferred, usedPorts, sshPortRange) ?? preferred

const countKeyEntries = (envText: string, baseKey: string): number => {
  const prefix = `${baseKey}__`
  return parseEnvEntries(envText)
    .filter((entry) =>
      entry.value.trim().length > 0 && (entry.key === baseKey || entry.key.startsWith(prefix)))
    .length
}

const jsonResponse = (data: unknown, status: number) =>
  pipe(
    HttpServerResponse.json(data),
    Effect.map(HttpServerResponse.setStatus(status))
  )

const htmlResponse = (data: string, status: number) =>
  Effect.succeed(HttpServerResponse.setStatus(HttpServerResponse.html(data), status))

const errorResponse = (error: ApiError) => {
  if (ParseResult.isParseError(error)) {
    const message = ParseResult.TreeFormatter.formatIssueSync(error.issue)
    return jsonResponse({
      error: {
        type: "ParseError",
        message
      }
    }, 400)
  }

  if (error._tag === "ProjectNotFoundError") {
    return jsonResponse({
      error: {
        type: error._tag,
        message: `Project not found: ${error.id}`,
        root: error.root
      }
    }, 404)
  }

  if (error._tag === "ConfigNotFoundError") {
    return jsonResponse({
      error: {
        type: error._tag,
        message: `Config not found: ${error.path}`
      }
    }, 404)
  }

  if (error._tag === "ConfigDecodeError") {
    return jsonResponse({
      error: {
        type: error._tag,
        message: `Config decode failed at ${error.path}`,
        reason: error.message
      }
    }, 400)
  }

  if (error._tag === "FileExistsError") {
    return jsonResponse({
      error: {
        type: error._tag,
        message: `File exists: ${error.path}`
      }
    }, 409)
  }

  if (error._tag === "DockerCommandError") {
    return jsonResponse({
      error: {
        type: error._tag,
        message: `docker compose failed: exit ${error.exitCode}`
      }
    }, 502)
  }

  if (error._tag === "CodexAuthError") {
    return jsonResponse({
      error: {
        type: error._tag,
        message: error.message
      }
    }, 400)
  }

  if (error._tag === "StaticAssetNotFoundError") {
    return jsonResponse({
      error: {
        type: error._tag,
        message: `Asset not found: ${error.path}`
      }
    }, 404)
  }

  if (error._tag === "RequestError") {
    return jsonResponse({
      error: {
        type: error._tag,
        message: error.message
      }
    }, 400)
  }

  return jsonResponse({
    error: {
      type: "UnknownError",
      message: String(error)
    }
  }, 500)
}

const htmlErrorResponse = (error: ApiError) =>
  htmlResponse(
    renderOutputPage("Error", error instanceof Error ? error.message : String(error)),
    500
  )

const serveFile = (path: string) =>
  Effect.gen(function* (_) {
    const fs = yield* _(FileSystem.FileSystem)
    const exists = yield* _(fs.exists(path))
    if (!exists) {
      return yield* _(Effect.fail(new StaticAssetNotFoundError({ path })))
    }
    return yield* _(HttpServerResponse.file(path))
  })

const resolveProjectCodexTarget = (
  projectsRoot: string,
  project: { readonly id: string }
): Effect.Effect<string, CodexAuthError | PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* (_) {
    const path = yield* _(Path.Path)
    const root = yield* _(resolveWritableCodexRoot(projectsRoot))
    return path.resolve(resolveProjectCodexAuthPath(root, project.id))
  })

const isWritableDirectory = (
  dirPath: string
): Effect.Effect<boolean, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* (_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const exists = yield* _(fs.exists(dirPath))
    if (!exists) {
      return false
    }
    const info = yield* _(fs.stat(dirPath))
    if (info.type !== "Directory") {
      return false
    }
    const testPath = path.join(dirPath, ".dg-write-test")
    const write = yield* _(Effect.either(fs.writeFileString(testPath, "ok")))
    if (write._tag === "Left") {
      return false
    }
    yield* _(fs.remove(testPath, { force: true }))
    return true
  })

const syncProjectCodexAuth = (
  projectsRoot: string,
  project: { readonly id: string; readonly codexAuthPath: string }
): Effect.Effect<void, CodexAuthError | PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* (_) {
    const path = yield* _(Path.Path)
    const resolvedRoot = path.resolve(projectsRoot)
    const resolvedTarget = path.resolve(project.codexAuthPath)
    const targetWritable = yield* _(isWritableDirectory(resolvedTarget))
    if (!targetWritable) {
      yield* _(
        Effect.fail(
          new CodexAuthError({
            message: `Codex target path not writable: ${resolvedTarget}`
          })
        )
      )
      return
    }

    const projectEnv = yield* _(readEnvFile(project.codexAuthPath))
    const codexLabel = resolveProjectCodexLabel(projectEnv) ?? "default"

    const codexRootResult = yield* _(Effect.either(resolveWritableCodexRoot(resolvedRoot)))
    const codexRootPath = codexRootResult._tag === "Right" ? codexRootResult.right : null
    const expectedRoot = resolveCodexAuthPath(resolvedRoot)
    if (codexRootResult._tag === "Right") {
      const resolvedCodexRoot = path.resolve(codexRootResult.right)
      if (resolvedCodexRoot !== path.resolve(expectedRoot)) {
        yield* _(Console.log(`codex auth root fallback: ${expectedRoot} -> ${resolvedCodexRoot}`))
      }
    }

    let accountPath: string | null = null
    if (codexRootPath !== null) {
      const accountResult = yield* _(Effect.either(findCodexAccountPath(codexRootPath, codexLabel)))
      if (accountResult._tag === "Right") {
        accountPath = accountResult.right
      }
    }

    const fallbackSource = resolveCodexSourcePath(
      undefined,
      process.env["HOME"],
      process.env["CODEX_HOME"]
    )
    const resolvedSource = accountPath
      ? path.resolve(accountPath)
      : fallbackSource
        ? path.resolve(fallbackSource)
        : null
    if (resolvedSource === null) {
      yield* _(
        Console.warn(
          `codex sync skipped project=${project.id} reason=source-not-connected`
        )
      )
      return
    }

    const status = yield* _(readCodexAuthStatus(resolvedSource))
    if (!status.connected) {
      yield* _(
        Console.warn(
          `codex sync skipped project=${project.id} reason=source-not-connected source=${resolvedSource}`
        )
      )
      return
    }

    const targetPath = yield* _(resolveProjectCodexTarget(projectsRoot, project))
    if (resolvedSource === targetPath) {
      return
    }

    yield* _(
      Console.log(
        `codex sync project=${project.id} label=${codexLabel} source=${resolvedSource} target=${targetPath}`
      )
    )
    yield* _(copyCodexAuthDir(resolvedSource, targetPath))
  })

// CHANGE: build the HTTP router for docker-git orchestration
// WHY: expose a typed API and static UI for managing containers
// QUOTE(ТЗ): "Просто сделай сайт и бекенд приложение"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall request: route(request) -> response(request)
// PURITY: SHELL
// EFFECT: Effect<HttpRouter, ApiError, HttpPlatform>
// INVARIANT: all errors mapped to HTTP responses
// COMPLEXITY: O(1) per route
export const makeRouter = ({ cwd, projectsRoot, webRoot, vendorRoot, terminalPort }: ServerPaths) => {
  const projectParams = HttpRouter.schemaPathParams(ProjectParamsSchema)

  const withDeploymentGuard = <R>(
    project: { readonly id: string },
    effect: Effect.Effect<void, ApiError, R>
  ): Effect.Effect<void, ApiError, R> =>
    Effect.gen(function* (_) {
      const running = yield* _(isDeploymentActive(project.id))
      if (running) {
        yield* _(appendDeploymentLog(project.id, "[skip] deployment already running"))
        yield* _(setDeploymentStatus(project.id, "build", "deployment already running"))
        return
      }
      // CHANGE: clear logs before starting a new deployment
      // WHY: ensure the UI reflects the fresh run immediately
      // QUOTE(ТЗ): "Да чисти логи деплоя"
      // REF: user-request-2026-01-15
      // SOURCE: n/a
      // FORMAT THEOREM: forall run: start(run) -> logs(run) = empty
      // PURITY: SHELL
      // EFFECT: Effect<void, never, never>
      // INVARIANT: logs are empty before the new run emits output
      // COMPLEXITY: O(1)
      yield* _(clearDeploymentLogs(project.id))
      yield* _(markDeploymentActive(project.id))
      yield* _(
        Effect.forkDaemon(
          effect.pipe(
            Effect.onInterrupt(() =>
              pipe(
                appendDeploymentLog(project.id, "[interrupt] deployment interrupted"),
                Effect.zipRight(
                  setDeploymentStatus(project.id, "error", "deployment interrupted")
                )
              )
            ),
            Effect.catchAll((error) =>
              pipe(
                appendDeploymentLog(project.id, `[error] ${String(error)}`),
                Effect.zipRight(
                  setDeploymentStatus(project.id, "error", "deployment failed")
                )
              )
            ),
            Effect.ensuring(markDeploymentInactive(project.id))
          )
        )
      )
    })

  const uiRouterBase = HttpRouter.empty.pipe(
    HttpRouter.get(
      "/",
      pipe(
        scanProjects(projectsRoot, cwd),
        Effect.map((index) => renderDashboard(index)),
        Effect.map((html) => HttpServerResponse.html(html)),
        Effect.catchAll(htmlErrorResponse)
      )
    ),
    HttpRouter.get(
      "/clone",
      Effect.gen(function* (_) {
        const path = yield* _(Path.Path)
        const resolvedRoot = path.resolve(projectsRoot)
        const globalEnvPath = resolveGlobalEnvPath(resolvedRoot)
        const envText = yield* _(readEnvFile(globalEnvPath))
        const githubTokenEntries = countKeyEntries(envText, "GITHUB_TOKEN")
        const html = renderClonePage(globalEnvPath, githubTokenEntries)
        return HttpServerResponse.html(html)
      }).pipe(
        Effect.tapError((error) => Console.error(`clone failed: ${String(error)}`)),
        Effect.catchAll(htmlErrorResponse)
      )
    ),
    HttpRouter.get(
      "/integrations",
      Effect.gen(function* (_) {
        const path = yield* _(Path.Path)
        const resolvedRoot = path.resolve(projectsRoot)
        const globalEnvPath = resolveGlobalEnvPath(resolvedRoot)
        const codexRootPath = yield* _(resolveWritableCodexRoot(resolvedRoot))
        const envText = yield* _(readEnvFile(globalEnvPath))
        const githubTokenEntries = countKeyEntries(envText, "GITHUB_TOKEN")
        const gitTokenEntries = countKeyEntries(envText, "GIT_AUTH_TOKEN")
        const claudeKeyEntries = countKeyEntries(envText, "ANTHROPIC_API_KEY")
        const codexAccounts = yield* _(listCodexAccounts(codexRootPath))
        const html = renderIntegrationsPage(
          globalEnvPath,
          githubTokenEntries,
          gitTokenEntries,
          claudeKeyEntries,
          codexRootPath,
          codexAccounts
        )
        return HttpServerResponse.html(html)
      }).pipe(Effect.catchAll(htmlErrorResponse))
    ),
    HttpRouter.get(
      "/integrations/github/token",
      Effect.succeed(renderGithubTokenHelpPage()).pipe(
        Effect.map((html) => HttpServerResponse.html(html)),
        Effect.catchAll(htmlErrorResponse)
      )
    ),
    HttpRouter.post(
      "/integrations/github/connect",
      Effect.gen(function* (_) {
        const { githubToken, githubLabel } = yield* _(HttpServerRequest.schemaBodyUrlParams(GithubConnectSchema))
        const path = yield* _(Path.Path)
        const resolvedRoot = path.resolve(projectsRoot)
        const globalEnvPath = resolveGlobalEnvPath(resolvedRoot)
        const envText = yield* _(readEnvFile(globalEnvPath))
        const key = buildGithubTokenKey(githubLabel?.trim() ?? "")
        const nextText = upsertEnvKey(envText, key, githubToken)
        yield* _(writeEnvFile(globalEnvPath, nextText))
        return HttpServerResponse.redirect("/integrations")
      }).pipe(Effect.catchAll(htmlErrorResponse))
    ),
    HttpRouter.post(
      "/integrations/github/disconnect",
      Effect.gen(function* (_) {
        const { githubLabel } = yield* _(HttpServerRequest.schemaBodyUrlParams(GithubDisconnectSchema))
        const path = yield* _(Path.Path)
        const resolvedRoot = path.resolve(projectsRoot)
        const globalEnvPath = resolveGlobalEnvPath(resolvedRoot)
        const envText = yield* _(readEnvFile(globalEnvPath))
        const key = buildGithubTokenKey(githubLabel?.trim() ?? "")
        const nextText = upsertEnvKey(envText, key, "")
        yield* _(writeEnvFile(globalEnvPath, nextText))
        return HttpServerResponse.redirect("/integrations")
      }).pipe(Effect.catchAll(htmlErrorResponse))
    ),
    HttpRouter.post(
      "/integrations/git/connect",
      Effect.gen(function* (_) {
        const { gitLabel, gitToken, gitUser } = yield* _(HttpServerRequest.schemaBodyUrlParams(GitConnectSchema))
        const path = yield* _(Path.Path)
        const resolvedRoot = path.resolve(projectsRoot)
        const globalEnvPath = resolveGlobalEnvPath(resolvedRoot)
        const envText = yield* _(readEnvFile(globalEnvPath))
        const label = gitLabel?.trim() ?? ""
        const tokenKey = buildLabeledEnvKey("GIT_AUTH_TOKEN", label)
        const userKey = buildLabeledEnvKey("GIT_AUTH_USER", label)
        const trimmedGitUser = gitUser?.trim() ?? ""
        const user = trimmedGitUser.length > 0 ? trimmedGitUser : "x-access-token"
        const withToken = upsertEnvKey(envText, tokenKey, gitToken)
        const nextText = upsertEnvKey(withToken, userKey, user)
        yield* _(writeEnvFile(globalEnvPath, nextText))
        return HttpServerResponse.redirect("/integrations")
      }).pipe(Effect.catchAll(htmlErrorResponse))
    ),
    HttpRouter.post(
      "/integrations/git/disconnect",
      Effect.gen(function* (_) {
        const { gitLabel } = yield* _(HttpServerRequest.schemaBodyUrlParams(GitDisconnectSchema))
        const path = yield* _(Path.Path)
        const resolvedRoot = path.resolve(projectsRoot)
        const globalEnvPath = resolveGlobalEnvPath(resolvedRoot)
        const envText = yield* _(readEnvFile(globalEnvPath))
        const label = gitLabel?.trim() ?? ""
        const tokenKey = buildLabeledEnvKey("GIT_AUTH_TOKEN", label)
        const userKey = buildLabeledEnvKey("GIT_AUTH_USER", label)
        const withoutToken = upsertEnvKey(envText, tokenKey, "")
        const nextText = upsertEnvKey(withoutToken, userKey, "")
        yield* _(writeEnvFile(globalEnvPath, nextText))
        return HttpServerResponse.redirect("/integrations")
      }).pipe(Effect.catchAll(htmlErrorResponse))
    ),
    HttpRouter.post(
      "/integrations/claude/connect",
      Effect.gen(function* (_) {
        const { claudeApiKey, claudeLabel } = yield* _(
          HttpServerRequest.schemaBodyUrlParams(ClaudeConnectSchema)
        )
        const path = yield* _(Path.Path)
        const resolvedRoot = path.resolve(projectsRoot)
        const globalEnvPath = resolveGlobalEnvPath(resolvedRoot)
        const envText = yield* _(readEnvFile(globalEnvPath))
        const key = buildLabeledEnvKey("ANTHROPIC_API_KEY", claudeLabel?.trim() ?? "")
        const nextText = upsertEnvKey(envText, key, claudeApiKey)
        yield* _(writeEnvFile(globalEnvPath, nextText))
        return HttpServerResponse.redirect("/integrations")
      }).pipe(Effect.catchAll(htmlErrorResponse))
    ),
    HttpRouter.post(
      "/integrations/claude/disconnect",
      Effect.gen(function* (_) {
        const { claudeLabel } = yield* _(
          HttpServerRequest.schemaBodyUrlParams(ClaudeDisconnectSchema)
        )
        const path = yield* _(Path.Path)
        const resolvedRoot = path.resolve(projectsRoot)
        const globalEnvPath = resolveGlobalEnvPath(resolvedRoot)
        const envText = yield* _(readEnvFile(globalEnvPath))
        const key = buildLabeledEnvKey("ANTHROPIC_API_KEY", claudeLabel?.trim() ?? "")
        const nextText = upsertEnvKey(envText, key, "")
        yield* _(writeEnvFile(globalEnvPath, nextText))
        return HttpServerResponse.redirect("/integrations")
      }).pipe(Effect.catchAll(htmlErrorResponse))
    ),
    HttpRouter.post(
      "/integrations/codex/connect",
      Effect.gen(function* (_) {
        const { codexSource, codexLabel } = yield* _(HttpServerRequest.schemaBodyUrlParams(CodexConnectSchema))
        const path = yield* _(Path.Path)
        const resolvedRoot = path.resolve(projectsRoot)
        const codexRootPath = yield* _(resolveWritableCodexRoot(resolvedRoot))
        const expectedRoot = resolveCodexAuthPath(resolvedRoot)
        const source = resolveCodexSourcePath(
          codexSource,
          process.env["HOME"],
          process.env["CODEX_HOME"]
        )
        if (source === null) {
          yield* _(
            Effect.fail(
              new CodexAuthError({
                message: "Codex source path not provided and HOME is not set"
              })
            )
          )
          return HttpServerResponse.redirect("/integrations")
        }
        const resolvedSource = path.isAbsolute(source) ? source : path.resolve(cwd, source)
        const resolvedRootPath = path.resolve(codexRootPath)
        if (resolvedRootPath !== path.resolve(expectedRoot)) {
          yield* _(Console.log(`codex auth root fallback: ${expectedRoot} -> ${resolvedRootPath}`))
        }
        yield* _(
          Console.log(
            `codex import start label=${codexLabel?.trim() ?? "default"} source=${resolvedSource}`
          )
        )
        yield* _(importCodexAuthDir(resolvedSource, resolvedRootPath, codexLabel ?? ""))
        yield* _(
          Console.log(`codex import done label=${codexLabel?.trim() ?? "default"}`)
        )
        return HttpServerResponse.redirect("/integrations")
      }).pipe(Effect.catchAll(htmlErrorResponse))
    ),
    HttpRouter.post(
      "/integrations/codex/login",
      Effect.gen(function* (_) {
        const { codexLabel } = yield* _(HttpServerRequest.schemaBodyUrlParams(CodexCliLoginSchema))
        yield* _(
          Console.log(`codex login requested label=${codexLabel?.trim() ?? "default"}`)
        )
        const html = renderCodexLoginPage(codexLabel ?? null, terminalPort)
        return HttpServerResponse.html(html)
      }).pipe(Effect.catchAll(htmlErrorResponse))
    ),
    HttpRouter.post(
      "/integrations/codex/disconnect",
      Effect.gen(function* (_) {
        const { codexLabel } = yield* _(HttpServerRequest.schemaBodyUrlParams(CodexConnectSchema))
        const path = yield* _(Path.Path)
        const resolvedRoot = path.resolve(projectsRoot)
        const codexRootPath = yield* _(resolveWritableCodexRoot(resolvedRoot))
        const expectedRoot = resolveCodexAuthPath(resolvedRoot)
        if (path.resolve(codexRootPath) !== path.resolve(expectedRoot)) {
          yield* _(Console.log(`codex auth root fallback: ${expectedRoot} -> ${codexRootPath}`))
        }
        yield* _(
          Console.log(`codex disconnect label=${codexLabel?.trim() ?? "default"}`)
        )
        yield* _(removeCodexAccount(codexRootPath, codexLabel ?? "default"))
        return HttpServerResponse.redirect("/integrations")
      }).pipe(Effect.catchAll(htmlErrorResponse))
    ),
    HttpRouter.post(
      "/clone",
      Effect.gen(function* (_) {
        const { repoUrl, repoRef, githubLabel } = yield* _(
          HttpServerRequest.schemaBodyUrlParams(CloneFormSchema)
        )
        const trimmedRepoUrl = repoUrl.trim()
        if (trimmedRepoUrl.length === 0) {
          return HttpServerResponse.html(
            renderOutputPage("Clone error", "Repo URL is required.")
          )
        }

        yield* _(
          Console.log(
            `clone request repo=${trimmedRepoUrl} ref=${repoRef?.trim() ?? ""} label=${githubLabel?.trim() ?? ""}`
          )
        )

        const path = yield* _(Path.Path)
        const resolvedRoot = path.resolve(projectsRoot)
        const codexRootPath = yield* _(resolveWritableCodexRoot(resolvedRoot))
        const expectedCodexRoot = resolveCodexAuthPath(resolvedRoot)
        const resolvedCodexRoot = path.resolve(codexRootPath)
        if (resolvedCodexRoot !== path.resolve(expectedCodexRoot)) {
          yield* _(Console.log(`codex auth root fallback: ${expectedCodexRoot} -> ${resolvedCodexRoot}`))
        }
        const repoSlug = deriveRepoSlug(trimmedRepoUrl)
        const projectCodexPath = resolveProjectCodexAuthPath(resolvedCodexRoot, repoSlug)
        const outDir = path.join(resolvedRoot, repoSlug)
        const trimmedRepoRef = repoRef?.trim() ?? ""
        const index = yield* _(scanProjects(projectsRoot, cwd))
        const usedPorts = index.projects.map((project) => project.sshPort)
        const selectedPort = chooseSshPort(defaultTemplateConfig.sshPort, usedPorts)
        const raw: RawOptions = {
          repoUrl: trimmedRepoUrl,
          codexAuthPath: projectCodexPath,
          outDir,
          up: false,
          ...(selectedPort !== defaultTemplateConfig.sshPort
            ? { sshPort: String(selectedPort) }
            : {}),
          ...(trimmedRepoRef.length > 0 ? { repoRef: trimmedRepoRef } : {})
        }

        const parsed = buildCreateCommand(raw)

        return yield* _(
          Either.match(parsed, {
            onLeft: (error) =>
              Effect.succeed(
                HttpServerResponse.html(
                  renderOutputPage("Invalid clone request", formatParseError(error))
                )
              ),
            onRight: (create) =>
              Effect.gen(function* (_) {
                yield* _(createProject(create))
                const project = yield* _(loadProject(projectsRoot, repoSlug, cwd))
                const selectedLabel = githubLabel?.trim() ?? ""
                if (selectedLabel.length > 0) {
                  const globalEnvPath = resolveGlobalEnvPath(resolvedRoot)
                  const envText = yield* _(readEnvFile(globalEnvPath))
                  const tokens = listGithubTokens(envText)
                  const selected = findGithubTokenByLabel(tokens, selectedLabel)
                  if (selected === null) {
                    return HttpServerResponse.html(
                      renderOutputPage(
                        "GitHub token not found",
                        `Label not found: ${selectedLabel}`
                      )
                    )
                  }
                  const projectEnv = yield* _(readEnvFile(project.envProjectPath))
                  const withGitToken = upsertEnvKey(
                    projectEnv,
                    "GIT_AUTH_TOKEN",
                    selected.token
                  )
                  const withGhToken = upsertEnvKey(withGitToken, "GH_TOKEN", selected.token)
                  const withGitLabel = upsertEnvKey(withGhToken, projectGitLabelKey, "")
                  const nextProjectEnv = upsertEnvKey(withGitLabel, projectGithubLabelKey, selected.label)
                  yield* _(writeEnvFile(project.envProjectPath, nextProjectEnv))
                }
                yield* _(syncProjectCodexAuth(projectsRoot, project))
                yield* _(clearDeploymentLogs(project.id))
                yield* _(setDeploymentStatus(project.id, "build", "docker compose --progress=plain build"))
                yield* _(appendDeploymentLog(project.id, "$ docker compose --progress=plain build"))
                yield* _(
                  runComposeWithStatus(
                    project.directory,
                    ["--progress", "plain", "build"],
                    [0],
                    project.id,
                    "build"
                  ).pipe(
                    Effect.tapError(() =>
                      setDeploymentStatus(project.id, "error", "docker compose build failed")
                    )
                  )
                )
                yield* _(setDeploymentStatus(project.id, "up", "docker compose up -d"))
                yield* _(appendDeploymentLog(project.id, "$ docker compose up -d"))
                yield* _(
                  runComposeWithStatus(
                    project.directory,
                    ["up", "-d"],
                    [0],
                    project.id,
                    "up"
                  ).pipe(
                    Effect.tapError(() =>
                      setDeploymentStatus(project.id, "error", "docker compose up failed")
                    )
                  )
                )
                yield* _(setDeploymentStatus(project.id, "running", "Container running"))
                const index = yield* _(scanProjects(projectsRoot, cwd))
                const html = renderDashboard(
                  index,
                  `Clone completed for ${repoSlug}.`
                )
                return HttpServerResponse.html(html)
              })
          })
        )
      }).pipe(Effect.catchAll(htmlErrorResponse))
    )
  )

  const uiRouter = uiRouterBase.pipe(
    HttpRouter.get(
      "/terminal/:projectId",
      pipe(
        projectParams,
        Effect.flatMap(({ projectId }) => loadProject(projectsRoot, projectId, cwd)),
        Effect.map((project) => renderTerminalPage(project, terminalPort)),
        Effect.map((html) => HttpServerResponse.html(html)),
        Effect.catchAll(htmlErrorResponse)
      )
    ),
    HttpRouter.get(
      "/env/:projectId",
      pipe(
        projectParams,
        Effect.flatMap(({ projectId }) => loadProject(projectsRoot, projectId, cwd)),
        Effect.flatMap((project) =>
          Effect.gen(function* (_) {
            const path = yield* _(Path.Path)
            const resolvedRoot = path.resolve(projectsRoot)
            const integrationsEnvPath = resolveGlobalEnvPath(resolvedRoot)
            const codexRootPath = yield* _(resolveWritableCodexRoot(resolvedRoot))
            const data = yield* _(
              Effect.all({
                project: Effect.succeed(project),
                globalEnv: readEnvFile(project.envGlobalPath),
                projectEnv: readEnvFile(project.envProjectPath),
                integrationsEnv: readEnvFile(integrationsEnvPath),
                codexAccounts: listCodexAccounts(codexRootPath),
                codexProject: readCodexAuthStatus(project.codexAuthPath)
              })
            )
            return data
          })
        ),
        Effect.flatMap(({ project, globalEnv, projectEnv, integrationsEnv, codexAccounts, codexProject }) =>
          Effect.gen(function* (_) {
            const githubTokenEntries = countKeyEntries(integrationsEnv, "GITHUB_TOKEN")
            const gitTokenEntries = countKeyEntries(integrationsEnv, "GIT_AUTH_TOKEN")
            const claudeKeyEntries = countKeyEntries(integrationsEnv, "ANTHROPIC_API_KEY")

            const projectGithubLabel = resolveProjectGithubLabel(projectEnv)
            const projectGithubToken = resolveProjectGithubToken(projectEnv)
            const activeGithubLabel = projectGithubLabel ?? (projectGithubToken === null ? null : "custom")

            const activeProjectGitLabel = resolveProjectGitLabel(projectEnv)
            const activeProjectGitToken = resolveProjectGitToken(projectEnv)
            const activeGitLabel = activeProjectGitLabel ?? (activeProjectGitToken === null ? null : "custom")

            const activeProjectClaudeLabel = resolveProjectClaudeLabel(projectEnv)
            const activeProjectClaudeApiKey = resolveProjectClaudeApiKey(projectEnv)
            const activeClaudeLabel = activeProjectClaudeLabel ?? (activeProjectClaudeApiKey === null ? null : "custom")

            const codexLabel = resolveProjectCodexLabel(projectEnv)
            const activeCodexLabel = codexLabel ?? (codexProject.connected ? "custom" : null)
            return renderEnvPage(
              project,
              globalEnv,
              projectEnv,
              githubTokenEntries,
              activeGithubLabel,
              gitTokenEntries,
              activeGitLabel,
              claudeKeyEntries,
              activeClaudeLabel,
              codexAccounts,
              activeCodexLabel
            )
          })
        ),
        Effect.map((html) => HttpServerResponse.html(html)),
        Effect.catchAll(htmlErrorResponse)
      )
    ),
    HttpRouter.post(
      "/env/:projectId",
      Effect.gen(function* (_) {
        const { projectId } = yield* _(projectParams)
        const { globalEnv, projectEnv } = yield* _(HttpServerRequest.schemaBodyUrlParams(EnvFormSchema))
        const project = yield* _(loadProject(projectsRoot, projectId, cwd))
        yield* _(writeEnvFile(project.envGlobalPath, globalEnv))
        yield* _(writeEnvFile(project.envProjectPath, projectEnv))
        return HttpServerResponse.redirect(`/env/${encodeURIComponent(project.id)}`)
      }).pipe(Effect.catchAll(htmlErrorResponse))
    ),
    HttpRouter.post(
      "/env/:projectId/git/identity",
      Effect.gen(function* (_) {
        const { projectId } = yield* _(projectParams)
        const { gitUserName, gitUserEmail } = yield* _(
          HttpServerRequest.schemaBodyUrlParams(GitIdentitySchema)
        )
        const project = yield* _(loadProject(projectsRoot, projectId, cwd))
        const projectEnv = yield* _(readEnvFile(project.envProjectPath))
        const withName = upsertEnvKey(projectEnv, "GIT_USER_NAME", gitUserName)
        const nextProjectEnv = upsertEnvKey(withName, "GIT_USER_EMAIL", gitUserEmail)
        yield* _(writeEnvFile(project.envProjectPath, nextProjectEnv))
        return HttpServerResponse.redirect(`/env/${encodeURIComponent(project.id)}`)
      }).pipe(Effect.catchAll(htmlErrorResponse))
    ),
    HttpRouter.post(
      "/env/:projectId/connect/github",
      Effect.gen(function* (_) {
        const { projectId } = yield* _(projectParams)
        const { githubLabel } = yield* _(
          HttpServerRequest.schemaBodyUrlParams(GithubProjectConnectSchema)
        )
        const project = yield* _(loadProject(projectsRoot, projectId, cwd))
        const path = yield* _(Path.Path)
        const resolvedRoot = path.resolve(projectsRoot)
        const globalEnvPath = resolveGlobalEnvPath(resolvedRoot)
        const globalEnv = yield* _(readEnvFile(globalEnvPath))
        const tokens = listGithubTokens(globalEnv)
        const selected = findGithubTokenByLabel(tokens, githubLabel)
        if (selected === null) {
          return HttpServerResponse.html(
            renderOutputPage("GitHub token not found", `Label not found: ${githubLabel}`)
          )
        }
        const projectEnv = yield* _(readEnvFile(project.envProjectPath))
        const withGitToken = upsertEnvKey(projectEnv, "GIT_AUTH_TOKEN", selected.token)
        const withGhToken = upsertEnvKey(withGitToken, "GH_TOKEN", selected.token)
        const withGitLabel = upsertEnvKey(withGhToken, projectGitLabelKey, "")
        const nextProjectEnv = upsertEnvKey(withGitLabel, projectGithubLabelKey, selected.label)
        yield* _(writeEnvFile(project.envProjectPath, nextProjectEnv))
        return HttpServerResponse.redirect(`/env/${encodeURIComponent(project.id)}`)
      }).pipe(Effect.catchAll(htmlErrorResponse))
    ),
    HttpRouter.post(
      "/env/:projectId/disconnect/github",
      Effect.gen(function* (_) {
        const { projectId } = yield* _(projectParams)
        yield* _(HttpServerRequest.schemaBodyUrlParams(GithubProjectDisconnectSchema))
        const project = yield* _(loadProject(projectsRoot, projectId, cwd))
        const projectEnv = yield* _(readEnvFile(project.envProjectPath))
        const withoutGitToken = upsertEnvKey(projectEnv, "GIT_AUTH_TOKEN", "")
        const withGhToken = upsertEnvKey(withoutGitToken, "GH_TOKEN", "")
        const withGitLabel = upsertEnvKey(withGhToken, projectGitLabelKey, "")
        const nextProjectEnv = upsertEnvKey(withGitLabel, projectGithubLabelKey, "")
        yield* _(writeEnvFile(project.envProjectPath, nextProjectEnv))
        return HttpServerResponse.redirect(`/env/${encodeURIComponent(project.id)}`)
      }).pipe(Effect.catchAll(htmlErrorResponse))
    ),
    HttpRouter.post(
      "/env/:projectId/connect/git",
      Effect.gen(function* (_) {
        const { projectId } = yield* _(projectParams)
        const { gitLabel } = yield* _(HttpServerRequest.schemaBodyUrlParams(GitProjectConnectSchema))
        const project = yield* _(loadProject(projectsRoot, projectId, cwd))
        const path = yield* _(Path.Path)
        const resolvedRoot = path.resolve(projectsRoot)
        const globalEnvPath = resolveGlobalEnvPath(resolvedRoot)
        const globalEnv = yield* _(readEnvFile(globalEnvPath))
        const selected = findGitCredentialByLabel(globalEnv, gitLabel)
        if (selected === null) {
          return HttpServerResponse.html(
            renderOutputPage("Git credentials not found", `Label not found: ${gitLabel}`)
          )
        }
        const projectEnv = yield* _(readEnvFile(project.envProjectPath))
        const withToken = upsertEnvKey(projectEnv, "GIT_AUTH_TOKEN", selected.token)
        const withUser = upsertEnvKey(withToken, "GIT_AUTH_USER", selected.user)
        const withGhToken = upsertEnvKey(withUser, "GH_TOKEN", selected.token)
        const withGitLabel = upsertEnvKey(withGhToken, projectGitLabelKey, selected.label)
        const nextProjectEnv = upsertEnvKey(withGitLabel, projectGithubLabelKey, selected.label)
        yield* _(writeEnvFile(project.envProjectPath, nextProjectEnv))
        return HttpServerResponse.redirect(`/env/${encodeURIComponent(project.id)}`)
      }).pipe(Effect.catchAll(htmlErrorResponse))
    ),
    HttpRouter.post(
      "/env/:projectId/disconnect/git",
      Effect.gen(function* (_) {
        const { projectId } = yield* _(projectParams)
        yield* _(HttpServerRequest.schemaBodyUrlParams(GitProjectDisconnectSchema))
        const project = yield* _(loadProject(projectsRoot, projectId, cwd))
        const projectEnv = yield* _(readEnvFile(project.envProjectPath))
        const withoutToken = upsertEnvKey(projectEnv, "GIT_AUTH_TOKEN", "")
        const withoutUser = upsertEnvKey(withoutToken, "GIT_AUTH_USER", "")
        const withoutGhToken = upsertEnvKey(withoutUser, "GH_TOKEN", "")
        const withGitLabel = upsertEnvKey(withoutGhToken, projectGitLabelKey, "")
        const nextProjectEnv = upsertEnvKey(withGitLabel, projectGithubLabelKey, "")
        yield* _(writeEnvFile(project.envProjectPath, nextProjectEnv))
        return HttpServerResponse.redirect(`/env/${encodeURIComponent(project.id)}`)
      }).pipe(Effect.catchAll(htmlErrorResponse))
    ),
    HttpRouter.post(
      "/env/:projectId/connect/claude",
      Effect.gen(function* (_) {
        const { projectId } = yield* _(projectParams)
        const { claudeLabel } = yield* _(
          HttpServerRequest.schemaBodyUrlParams(ClaudeProjectConnectSchema)
        )
        const project = yield* _(loadProject(projectsRoot, projectId, cwd))
        const path = yield* _(Path.Path)
        const resolvedRoot = path.resolve(projectsRoot)
        const globalEnvPath = resolveGlobalEnvPath(resolvedRoot)
        const globalEnv = yield* _(readEnvFile(globalEnvPath))
        const selected = findClaudeApiKeyByLabel(globalEnv, claudeLabel)
        if (selected === null) {
          return HttpServerResponse.html(
            renderOutputPage("Claude key not found", `Label not found: ${claudeLabel}`)
          )
        }
        const projectEnv = yield* _(readEnvFile(project.envProjectPath))
        const withApiKey = upsertEnvKey(projectEnv, "ANTHROPIC_API_KEY", selected.apiKey)
        const nextProjectEnv = upsertEnvKey(withApiKey, projectClaudeLabelKey, selected.label)
        yield* _(writeEnvFile(project.envProjectPath, nextProjectEnv))
        return HttpServerResponse.redirect(`/env/${encodeURIComponent(project.id)}`)
      }).pipe(Effect.catchAll(htmlErrorResponse))
    ),
    HttpRouter.post(
      "/env/:projectId/disconnect/claude",
      Effect.gen(function* (_) {
        const { projectId } = yield* _(projectParams)
        yield* _(HttpServerRequest.schemaBodyUrlParams(ClaudeProjectDisconnectSchema))
        const project = yield* _(loadProject(projectsRoot, projectId, cwd))
        const projectEnv = yield* _(readEnvFile(project.envProjectPath))
        const withoutApiKey = upsertEnvKey(projectEnv, "ANTHROPIC_API_KEY", "")
        const nextProjectEnv = upsertEnvKey(withoutApiKey, projectClaudeLabelKey, "")
        yield* _(writeEnvFile(project.envProjectPath, nextProjectEnv))
        return HttpServerResponse.redirect(`/env/${encodeURIComponent(project.id)}`)
      }).pipe(Effect.catchAll(htmlErrorResponse))
    ),
    HttpRouter.post(
      "/env/:projectId/connect/codex",
      Effect.gen(function* (_) {
        const { projectId } = yield* _(projectParams)
        const { codexLabel } = yield* _(HttpServerRequest.schemaBodyUrlParams(CodexProjectConnectSchema))
        const project = yield* _(loadProject(projectsRoot, projectId, cwd))
        const path = yield* _(Path.Path)
        const resolvedRoot = path.resolve(projectsRoot)
        const resolvedTargetPath = yield* _(resolveProjectCodexTarget(projectsRoot, project))
        const targetWritable = yield* _(isWritableDirectory(resolvedTargetPath))
        if (!targetWritable) {
          return HttpServerResponse.html(
            renderOutputPage(
              "Codex auth error",
              `Target path not writable: ${resolvedTargetPath}`
            )
          )
        }
        const codexRootResult = yield* _(Effect.either(resolveWritableCodexRoot(resolvedRoot)))
        const expectedCodexRoot = resolveCodexAuthPath(resolvedRoot)
        const codexRootPath = codexRootResult._tag === "Right" ? codexRootResult.right : null
        if (codexRootResult._tag === "Right") {
          const resolvedCodexRoot = path.resolve(codexRootResult.right)
          if (resolvedCodexRoot !== path.resolve(expectedCodexRoot)) {
            yield* _(Console.log(`codex auth root fallback: ${expectedCodexRoot} -> ${resolvedCodexRoot}`))
          }
        } else {
          yield* _(Console.warn(`codex auth root not writable: ${expectedCodexRoot}`))
        }

        let accountPath: string | null = null
        if (codexRootPath !== null) {
          const accountResult = yield* _(Effect.either(findCodexAccountPath(codexRootPath, codexLabel)))
          if (accountResult._tag === "Right") {
            accountPath = accountResult.right
          }
        }

        const fallbackSource = resolveCodexSourcePath(
          undefined,
          process.env["HOME"],
          process.env["CODEX_HOME"]
        )
        const resolvedSource = accountPath
          ? path.resolve(accountPath)
          : fallbackSource
            ? path.resolve(fallbackSource)
            : null
        if (resolvedSource === null) {
          return HttpServerResponse.html(
            renderOutputPage("Codex account not found", `Label not found: ${codexLabel}`)
          )
        }
        if (accountPath === null && fallbackSource) {
          yield* _(Console.log(`codex attach fallback source=${resolvedSource}`))
        }
        if (resolvedSource === resolvedTargetPath) {
          return HttpServerResponse.redirect(`/env/${encodeURIComponent(project.id)}`)
        }
        const status = yield* _(readCodexAuthStatus(resolvedSource))
        if (!status.connected) {
          return HttpServerResponse.html(
            renderOutputPage("Codex not connected", "Connect Codex in Integrations first.")
          )
        }
        yield* _(
          Console.log(
            `codex attach label=${codexLabel} project=${project.id} source=${resolvedSource} target=${resolvedTargetPath}`
          )
        )
        yield* _(copyCodexAuthDir(resolvedSource, resolvedTargetPath))
        const projectEnv = yield* _(readEnvFile(project.envProjectPath))
        const nextProjectEnv = upsertEnvKey(projectEnv, "CODEX_AUTH_LABEL", codexLabel)
        yield* _(writeEnvFile(project.envProjectPath, nextProjectEnv))
        return HttpServerResponse.redirect(`/env/${encodeURIComponent(project.id)}`)
      }).pipe(Effect.catchAll(htmlErrorResponse))
    ),
    HttpRouter.post(
      "/env/:projectId/disconnect/codex",
      Effect.gen(function* (_) {
        const { projectId } = yield* _(projectParams)
        yield* _(HttpServerRequest.schemaBodyUrlParams(CodexProjectDisconnectSchema))
        const project = yield* _(loadProject(projectsRoot, projectId, cwd))
        const resolvedTargetPath = yield* _(resolveProjectCodexTarget(projectsRoot, project))
        const targetWritable = yield* _(isWritableDirectory(resolvedTargetPath))
        if (!targetWritable) {
          return HttpServerResponse.html(
            renderOutputPage(
              "Codex auth error",
              `Target path not writable: ${resolvedTargetPath}`
            )
          )
        }
        yield* _(Console.log(`codex detach project=${project.id}`))
        yield* _(clearCodexAuthDir(resolvedTargetPath))
        const projectEnv = yield* _(readEnvFile(project.envProjectPath))
        const nextProjectEnv = upsertEnvKey(projectEnv, "CODEX_AUTH_LABEL", "")
        yield* _(writeEnvFile(project.envProjectPath, nextProjectEnv))
        return HttpServerResponse.redirect(`/env/${encodeURIComponent(project.id)}`)
      }).pipe(Effect.catchAll(htmlErrorResponse))
    )
  )

  const uiRouterWithActions = uiRouter.pipe(
    HttpRouter.post(
      "/actions/:projectId/up",
      pipe(
        projectParams,
        Effect.flatMap(({ projectId }) => loadProject(projectsRoot, projectId, cwd)),
        Effect.tap((project) => Console.log(`deploy up: ${project.id}`)),
        Effect.flatMap((project) =>
          Effect.gen(function* (_) {
            const run = Effect.gen(function* (_) {
              yield* _(clearDeploymentLogs(project.id))
              yield* _(syncProjectCodexAuth(projectsRoot, project))
              yield* _(setDeploymentStatus(project.id, "build", "docker compose --progress=plain build"))
              yield* _(appendDeploymentLog(project.id, "$ docker compose --progress=plain build"))
              yield* _(
                runComposeWithStatus(
                  project.directory,
                  ["--progress", "plain", "build"],
                  [0],
                  project.id,
                  "build"
                ).pipe(
                  Effect.tapError(() =>
                    setDeploymentStatus(project.id, "error", "docker compose build failed")
                  )
                )
              )
              yield* _(setDeploymentStatus(project.id, "up", "docker compose up -d"))
              yield* _(appendDeploymentLog(project.id, "$ docker compose up -d"))
              yield* _(
                runComposeWithStatus(
                  project.directory,
                  ["up", "-d"],
                  [0],
                  project.id,
                  "up"
                ).pipe(
                  Effect.tapError(() =>
                    setDeploymentStatus(project.id, "error", "docker compose up failed")
                  )
                )
              )
              yield* _(setDeploymentStatus(project.id, "running", "Container running"))
            })
            yield* _(withDeploymentGuard(project, run))
            const index = yield* _(scanProjects(projectsRoot, cwd))
            return renderDashboard(index, "Docker compose up started.")
          })
        ),
        Effect.map((html) => HttpServerResponse.html(html)),
        Effect.tapError((error) => Console.error(`deploy up failed: ${String(error)}`)),
        Effect.catchAll(htmlErrorResponse)
      )
    ),
    HttpRouter.post(
      "/actions/:projectId/down",
      pipe(
        projectParams,
        Effect.flatMap(({ projectId }) => loadProject(projectsRoot, projectId, cwd)),
        Effect.tap((project) => Console.log(`deploy down: ${project.id}`)),
        Effect.flatMap((project) =>
          Effect.gen(function* (_) {
            const run = Effect.gen(function* (_) {
              yield* _(clearDeploymentLogs(project.id))
              yield* _(appendDeploymentLog(project.id, "$ docker compose down"))
              yield* _(setDeploymentStatus(project.id, "down", "docker compose down"))
              yield* _(
                runComposeWithStatus(
                  project.directory,
                  ["down"],
                  [0],
                  project.id,
                  "down"
                ).pipe(
                  Effect.tapError(() =>
                    setDeploymentStatus(project.id, "error", "docker compose down failed")
                  )
                )
              )
              yield* _(setDeploymentStatus(project.id, "idle", "Container stopped"))
            })
            yield* _(withDeploymentGuard(project, run))
            const index = yield* _(scanProjects(projectsRoot, cwd))
            return renderDashboard(index, "Docker compose down started.")
          })
        ),
        Effect.map((html) => HttpServerResponse.html(html)),
        Effect.tapError((error) => Console.error(`deploy down failed: ${String(error)}`)),
        Effect.catchAll(htmlErrorResponse)
      )
    ),
    HttpRouter.post(
      "/actions/:projectId/recreate",
      pipe(
        projectParams,
        Effect.flatMap(({ projectId }) => loadProject(projectsRoot, projectId, cwd)),
        Effect.tap((project) => Console.log(`deploy recreate: ${project.id}`)),
        Effect.flatMap((project) =>
          Effect.gen(function* (_) {
            const run = Effect.gen(function* (_) {
              yield* _(clearDeploymentLogs(project.id))
              const config = yield* _(readProjectConfig(project.directory))
              const index = yield* _(scanProjects(projectsRoot, cwd))
              const usedPorts = index.projects
                .filter((entry) => entry.id !== project.id)
                .map((entry) => entry.sshPort)
              const selectedPort = chooseSshPort(config.template.sshPort, usedPorts)
              const nextTemplate = selectedPort === config.template.sshPort
                ? config.template
                : { ...config.template, sshPort: selectedPort }
              if (selectedPort !== config.template.sshPort) {
                yield* _(
                  Console.log(
                    `ssh port reassigned for ${project.id}: ${config.template.sshPort} -> ${selectedPort}`
                  )
                )
              }
              yield* _(createProject({
                _tag: "Create",
                config: nextTemplate,
                outDir: project.directory,
                runUp: false,
                openSsh: false,
                force: true,
                forceEnv: false,
                waitForClone: false
              }))
              yield* _(syncProjectCodexAuth(projectsRoot, project))
              yield* _(setDeploymentStatus(project.id, "down", "docker compose down"))
              yield* _(appendDeploymentLog(project.id, "$ docker compose down"))
              yield* _(
                runComposeWithStatus(project.directory, ["down"], [0], project.id, "down").pipe(
                  Effect.tapError(() =>
                    setDeploymentStatus(project.id, "error", "docker compose down failed")
                  )
                )
              )
              yield* _(setDeploymentStatus(project.id, "build", "docker compose --progress=plain build"))
              yield* _(appendDeploymentLog(project.id, "$ docker compose --progress=plain build"))
              yield* _(
                runComposeWithStatus(
                  project.directory,
                  ["--progress", "plain", "build"],
                  [0],
                  project.id,
                  "build"
                ).pipe(
                  Effect.tapError(() =>
                    setDeploymentStatus(project.id, "error", "docker compose build failed")
                  )
                )
              )
              yield* _(setDeploymentStatus(project.id, "up", "docker compose up -d"))
              yield* _(appendDeploymentLog(project.id, "$ docker compose up -d"))
              yield* _(
                runComposeWithStatus(project.directory, ["up", "-d"], [0], project.id, "up").pipe(
                  Effect.tapError(() =>
                    setDeploymentStatus(project.id, "error", "docker compose up failed")
                  )
                )
              )
              yield* _(setDeploymentStatus(project.id, "running", "Container running"))
            })
            yield* _(withDeploymentGuard(project, run))
            const index = yield* _(scanProjects(projectsRoot, cwd))
            return renderDashboard(index, "Docker compose recreate started.")
          }).pipe(
            Effect.tapError(() =>
              setDeploymentStatus(project.id, "error", "docker compose recreate failed")
            )
          )
        ),
        Effect.map((html) => HttpServerResponse.html(html)),
        Effect.tapError((error) => Console.error(`deploy recreate failed: ${String(error)}`)),
        Effect.catchAll(htmlErrorResponse)
      )
    ),
    HttpRouter.get(
      "/projects/:projectId/ps",
      pipe(
        projectParams,
        Effect.flatMap(({ projectId }) => loadProject(projectsRoot, projectId, cwd)),
        Effect.flatMap((project) => readDockerComposePs(project.directory)),
        Effect.map((output) => renderOutputPage("docker compose ps", output)),
        Effect.map((html) => HttpServerResponse.html(html)),
        Effect.catchAll(htmlErrorResponse)
      )
    ),
    HttpRouter.get(
      "/projects/:projectId/logs",
      pipe(
        projectParams,
        Effect.flatMap(({ projectId }) => loadProject(projectsRoot, projectId, cwd)),
        Effect.flatMap((project) => readDockerComposeLogs(project.directory)),
        Effect.map((output) => renderOutputPage("docker compose logs", output)),
        Effect.map((html) => HttpServerResponse.html(html)),
        Effect.catchAll(htmlErrorResponse)
      )
    ),
    HttpRouter.get(
      "/deployments/:projectId/logs",
      pipe(
        projectParams,
        Effect.flatMap(({ projectId }) =>
          Effect.gen(function* (_) {
            const entries = yield* _(listDeploymentLogs(projectId))
            const status = yield* _(getDeploymentStatus(projectId))
            const output = entries
              .map((entry) => `${entry.timestamp} ${entry.line}`)
              .join("\n")
            return renderDeployLogsPage(
              projectId,
              output,
              status.phase,
              status.message,
              status.updatedAt
            )
          })
        ),
        Effect.map((html) => HttpServerResponse.html(html)),
        Effect.catchAll(htmlErrorResponse)
      )
    ),
    HttpRouter.get("/api/health", jsonResponse({ ok: true }, 200)),
    HttpRouter.get(
      "/api/deployments",
      pipe(
        listDeploymentStatuses(),
        Effect.flatMap((deployments) => jsonResponse({ deployments }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/api/deployments/:projectId/logs",
      pipe(
        projectParams,
        Effect.flatMap(({ projectId }) =>
          Effect.gen(function* (_) {
            const entries = yield* _(listDeploymentLogs(projectId))
            const status = yield* _(getDeploymentStatus(projectId))
            return { entries, status }
          })
        ),
        Effect.flatMap((payload) => jsonResponse(payload, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/api/deployments/:projectId/stream",
      pipe(
        projectParams,
        Effect.flatMap(({ projectId }) =>
          Effect.gen(function* (_) {
            const encoder = new TextEncoder()
            const ref = yield* _(Ref.make({ index: 0, statusAt: "", snapshotSent: false }))

            const encodeEvent = (event: string, data: unknown): Uint8Array =>
              encoder.encode(`event: ${event}
data: ${JSON.stringify(data)}

`)

            const poll = Effect.gen(function* (_) {
              const state = yield* _(Ref.get(ref))
              const entries = yield* _(listDeploymentLogs(projectId))
              const status = yield* _(getDeploymentStatus(projectId))

              // CHANGE: re-emit snapshot when logs reset
              // WHY: keep the UI aligned with cleared deployment output
              // QUOTE(ТЗ): "Да чисти логи деплоя"
              // REF: user-request-2026-01-15
              // SOURCE: n/a
              // FORMAT THEOREM: forall reset: snapshot(reset) -> ui(logs) = empty
              // PURITY: SHELL
              // EFFECT: Effect<Chunk<Uint8Array>, never, never>
              // INVARIANT: snapshot is sent when log length drops
              // COMPLEXITY: O(1)
              const resetDetected = state.snapshotSent && entries.length < state.index

              if (!state.snapshotSent || resetDetected) {
                yield* _(Ref.set(ref, {
                  index: entries.length,
                  statusAt: status.updatedAt,
                  snapshotSent: true
                }))
                return Chunk.of(encodeEvent("snapshot", { entries, status }))
              }

              const nextEntries = entries.slice(state.index)
              const events: Array<Uint8Array> = []
              if (nextEntries.length > 0) {
                for (const entry of nextEntries) {
                  events.push(encodeEvent("log", entry))
                }
              }

              if (status.updatedAt !== state.statusAt) {
                events.push(encodeEvent("status", status))
              }

              yield* _(Ref.set(ref, {
                index: entries.length,
                statusAt: status.updatedAt,
                snapshotSent: true
              }))

              if (events.length === 0) {
                yield* _(Effect.sleep(Duration.millis(500)))
                return Chunk.empty<Uint8Array>()
              }

              yield* _(Effect.sleep(Duration.millis(200)))
              return Chunk.fromIterable(events)
            })

            const stream = Stream.repeatEffectChunk(poll)

            return HttpServerResponse.stream(stream, {
              headers: {
                "content-type": "text/event-stream",
                "cache-control": "no-cache",
                "connection": "keep-alive"
              }
            })
          })
        ),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/api/projects",
      pipe(
        scanProjects(projectsRoot, cwd),
        Effect.flatMap((index) => jsonResponse(index, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/api/projects/:projectId",
      pipe(
        projectParams,
        Effect.flatMap(({ projectId }) => loadProject(projectsRoot, projectId, cwd)),
        Effect.flatMap((project) => jsonResponse({ project }, 200)),
        Effect.catchAll(errorResponse)
      )
    )
  )

  return uiRouterWithActions.pipe(
    HttpRouter.post(
      "/api/projects/:projectId/up",
      pipe(
        projectParams,
        Effect.flatMap(({ projectId }) => loadProject(projectsRoot, projectId, cwd)),
        Effect.flatMap((project) =>
          Effect.gen(function* (_) {
            const run = Effect.gen(function* (_) {
              yield* _(clearDeploymentLogs(project.id))
              yield* _(syncProjectCodexAuth(projectsRoot, project))
              yield* _(setDeploymentStatus(project.id, "build", "docker compose --progress=plain build"))
              yield* _(appendDeploymentLog(project.id, "$ docker compose --progress=plain build"))
              yield* _(
                runComposeWithStatus(
                  project.directory,
                  ["--progress", "plain", "build"],
                  [0],
                  project.id,
                  "build"
                ).pipe(
                  Effect.tapError(() =>
                    setDeploymentStatus(project.id, "error", "docker compose build failed")
                  )
                )
              )
              yield* _(setDeploymentStatus(project.id, "up", "docker compose up -d"))
              yield* _(appendDeploymentLog(project.id, "$ docker compose up -d"))
              yield* _(
                runComposeWithStatus(
                  project.directory,
                  ["up", "-d"],
                  [0],
                  project.id,
                  "up"
                ).pipe(
                  Effect.tapError(() =>
                    setDeploymentStatus(project.id, "error", "docker compose up failed")
                  )
                )
              )
              yield* _(setDeploymentStatus(project.id, "running", "Container running"))
            })
            yield* _(withDeploymentGuard(project, run))
            return { ok: true, started: true }
          })
        ),
        Effect.flatMap((payload) => jsonResponse(payload, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.post(
      "/api/projects/:projectId/down",
      pipe(
        projectParams,
        Effect.flatMap(({ projectId }) => loadProject(projectsRoot, projectId, cwd)),
        Effect.flatMap((project) =>
          Effect.gen(function* (_) {
            const run = Effect.gen(function* (_) {
              yield* _(clearDeploymentLogs(project.id))
              yield* _(setDeploymentStatus(project.id, "down", "docker compose down"))
              yield* _(appendDeploymentLog(project.id, "$ docker compose down"))
              yield* _(
                runComposeWithStatus(
                  project.directory,
                  ["down"],
                  [0],
                  project.id,
                  "down"
                ).pipe(
                  Effect.tapError(() =>
                    setDeploymentStatus(project.id, "error", "docker compose down failed")
                  )
                )
              )
              yield* _(setDeploymentStatus(project.id, "idle", "Container stopped"))
            })
            yield* _(withDeploymentGuard(project, run))
            return { ok: true, started: true }
          })
        ),
        Effect.flatMap((payload) => jsonResponse(payload, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.post(
      "/api/projects/:projectId/recreate",
      pipe(
        projectParams,
        Effect.flatMap(({ projectId }) => loadProject(projectsRoot, projectId, cwd)),
        Effect.flatMap((project) =>
          Effect.gen(function* (_) {
            const run = Effect.gen(function* (_) {
              yield* _(clearDeploymentLogs(project.id))
              const config = yield* _(readProjectConfig(project.directory))
              const index = yield* _(scanProjects(projectsRoot, cwd))
              const usedPorts = index.projects
                .filter((entry) => entry.id !== project.id)
                .map((entry) => entry.sshPort)
              const selectedPort = chooseSshPort(config.template.sshPort, usedPorts)
              const nextTemplate = selectedPort === config.template.sshPort
                ? config.template
                : { ...config.template, sshPort: selectedPort }
              if (selectedPort !== config.template.sshPort) {
                yield* _(
                  Console.log(
                    `ssh port reassigned for ${project.id}: ${config.template.sshPort} -> ${selectedPort}`
                  )
                )
              }
              yield* _(createProject({
                _tag: "Create",
                config: nextTemplate,
                outDir: project.directory,
                runUp: false,
                openSsh: false,
                force: true,
                forceEnv: false,
                waitForClone: false
              }))
              yield* _(syncProjectCodexAuth(projectsRoot, project))
              yield* _(setDeploymentStatus(project.id, "down", "docker compose down"))
              yield* _(appendDeploymentLog(project.id, "$ docker compose down"))
              yield* _(
                runComposeWithStatus(project.directory, ["down"], [0], project.id, "down").pipe(
                  Effect.tapError(() =>
                    setDeploymentStatus(project.id, "error", "docker compose down failed")
                  )
                )
              )
              yield* _(setDeploymentStatus(project.id, "build", "docker compose --progress=plain build"))
              yield* _(appendDeploymentLog(project.id, "$ docker compose --progress=plain build"))
              yield* _(
                runComposeWithStatus(
                  project.directory,
                  ["--progress", "plain", "build"],
                  [0],
                  project.id,
                  "build"
                ).pipe(
                  Effect.tapError(() =>
                    setDeploymentStatus(project.id, "error", "docker compose build failed")
                  )
                )
              )
              yield* _(setDeploymentStatus(project.id, "up", "docker compose up -d"))
              yield* _(appendDeploymentLog(project.id, "$ docker compose up -d"))
              yield* _(
                runComposeWithStatus(project.directory, ["up", "-d"], [0], project.id, "up").pipe(
                  Effect.tapError(() =>
                    setDeploymentStatus(project.id, "error", "docker compose up failed")
                  )
                )
              )
              yield* _(setDeploymentStatus(project.id, "running", "Container running"))
            }).pipe(
              Effect.tapError(() =>
                setDeploymentStatus(project.id, "error", "docker compose recreate failed")
              )
            )
            yield* _(withDeploymentGuard(project, run))
            return { ok: true, started: true }
          })
        ),
        Effect.flatMap((payload) => jsonResponse(payload, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/api/projects/:projectId/ps",
      pipe(
        projectParams,
        Effect.flatMap(({ projectId }) => loadProject(projectsRoot, projectId, cwd)),
        Effect.flatMap((project) => readDockerComposePs(project.directory)),
        Effect.flatMap((output) => jsonResponse({ output }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get(
      "/api/projects/:projectId/logs",
      pipe(
        projectParams,
        Effect.flatMap(({ projectId }) => loadProject(projectsRoot, projectId, cwd)),
        Effect.flatMap((project) => readDockerComposeLogs(project.directory)),
        Effect.flatMap((output) => jsonResponse({ output }, 200)),
        Effect.catchAll(errorResponse)
      )
    ),
    HttpRouter.get("/styles.css", pipe(serveFile(`${webRoot}/styles.css`), Effect.catchAll(errorResponse))),
    HttpRouter.get("/terminal.js", pipe(serveFile(`${webRoot}/terminal.js`), Effect.catchAll(errorResponse))),
    HttpRouter.get("/deploy.js", pipe(serveFile(`${webRoot}/deploy.js`), Effect.catchAll(errorResponse))),
    HttpRouter.get(
      "/deploy-logs.js",
      pipe(serveFile(`${webRoot}/deploy-logs.js`), Effect.catchAll(errorResponse))
    ),
    HttpRouter.get(
      "/vendor/xterm.js",
      pipe(serveFile(`${vendorRoot}/xterm/lib/xterm.js`), Effect.catchAll(errorResponse))
    ),
    HttpRouter.get(
      "/vendor/xterm.css",
      pipe(serveFile(`${vendorRoot}/xterm/css/xterm.css`), Effect.catchAll(errorResponse))
    )
  )
}
