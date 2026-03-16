import type {
  ApplyCommand,
  AttachCommand,
  AuthClaudeLoginCommand,
  AuthClaudeLogoutCommand,
  AuthClaudeStatusCommand,
  AuthCodexLoginCommand,
  AuthCodexLogoutCommand,
  AuthCodexStatusCommand,
  AuthGithubLoginCommand,
  AuthGithubLogoutCommand,
  AuthGithubStatusCommand,
  Command,
  CreateCommand,
  McpPlaywrightUpCommand,
  PanesCommand,
  ParseError,
  ScrapExportCommand,
  ScrapImportCommand,
  SessionsKillCommand,
  SessionsListCommand,
  SessionsLogsCommand,
  StateCommitCommand,
  StateInitCommand,
  StateSyncCommand
} from "@effect-template/lib/core/domain"
import { isInsideDocker } from "@effect-template/lib"
import type { AppError } from "@effect-template/lib/usecases/errors"
import { renderError } from "@effect-template/lib/usecases/errors"
import { Effect, Match, pipe } from "effect"

import { ApiClientError } from "./api-client.js"
import {
  apiAuthClaudeLogin,
  apiAuthClaudeLogout,
  apiAuthClaudeStatus,
  apiAuthCodexLogin,
  apiAuthCodexLogout,
  apiAuthCodexStatus,
  apiAuthGithubLogin,
  apiAuthGithubLogout,
  apiAuthGithubStatus,
  apiMcpPlaywrightUp,
  apiProjectApply,
  apiProjectCreate,
  apiProjectGet,
  apiProjectsDownAll,
  apiProjectsList,
  apiScrapExport,
  apiScrapImport,
  apiSessionsKill,
  apiSessionsList,
  apiSessionsLogs,
  apiStateCommit,
  apiStateInit,
  apiStatePath,
  apiStatePull,
  apiStatePush,
  apiStateStatus,
  apiStateSync
} from "./api-client.js"
import { readCommand } from "./cli/read-command.js"
import { runMenu } from "./menu.js"
import { attachTmux, attachTmuxFromProject, listTmuxPanes } from "./tmux.js"

// CHANGE: rewrite CLI program to use unified REST API
// WHY: CLI becomes thin HTTP client; business logic lives in API server
// QUOTE(ТЗ): "CLI → DOCKER_GIT_API_URL → REST API → packages/lib → Docker daemon"
// PURITY: SHELL
// EFFECT: Effect<void, AppError | ApiClientError, HttpClient | NodeContext>
// INVARIANT: ∀ cmd ∈ CLICommands \ {Attach, Panes, Menu}: handler(cmd) = httpCall(apiEndpoint(cmd))
// COMPLEXITY: O(1) per command

const isParseError = (error: AppError): error is ParseError =>
  error._tag === "UnknownCommand" ||
  error._tag === "UnknownOption" ||
  error._tag === "MissingOptionValue" ||
  error._tag === "MissingRequiredOption" ||
  error._tag === "InvalidOption" ||
  error._tag === "UnexpectedArgument"

const setExitCode = (code: number) =>
  Effect.sync(() => {
    process.exitCode = code
  })

const logErrorAndExit = (error: AppError) =>
  pipe(
    Effect.logError(renderError(error)),
    Effect.tap(() => setExitCode(1)),
    Effect.asVoid
  )

const logApiError = (e: ApiClientError) =>
  pipe(
    Effect.logError(`API error: ${e.message}`),
    Effect.tap(() => setExitCode(1)),
    Effect.asVoid
  )

const logMsg = (msg: string) => msg.trim().length > 0 ? Effect.log(msg) : Effect.void

type NonBaseCommand = Exclude<
  Command,
  | { readonly _tag: "Help" }
  | { readonly _tag: "Create" }
  | { readonly _tag: "Status" }
  | { readonly _tag: "DownAll" }
  | { readonly _tag: "Menu" }
>

// ─── State handlers ──────────────────────────────────────────────────────────

const handleStatePath = () => apiStatePath().pipe(Effect.flatMap(({ path }) => Effect.log(path)))

const handleStateInit = (cmd: StateInitCommand) =>
  apiStateInit({ repoUrl: cmd.repoUrl, repoRef: cmd.repoRef }).pipe(
    Effect.flatMap(({ output }) => logMsg(output))
  )

const handleStateStatus = () => apiStateStatus().pipe(Effect.flatMap(({ output }) => logMsg(output)))

const handleStatePull = () => apiStatePull().pipe(Effect.flatMap(({ output }) => logMsg(output)))

const handleStateCommit = (cmd: StateCommitCommand) =>
  apiStateCommit({ message: cmd.message }).pipe(
    Effect.flatMap(({ output }) => logMsg(output))
  )

const handleStatePush = () => apiStatePush().pipe(Effect.flatMap(({ output }) => logMsg(output)))

const handleStateSync = (cmd: StateSyncCommand) =>
  apiStateSync({ message: cmd.message ?? null }).pipe(
    Effect.flatMap(({ output }) => logMsg(output))
  )

// ─── Auth handlers ───────────────────────────────────────────────────────────

const handleAuthGithubLogin = (cmd: AuthGithubLoginCommand) =>
  apiAuthGithubLogin({
    label: cmd.label,
    token: cmd.token,
    scopes: cmd.scopes,
    envGlobalPath: cmd.envGlobalPath
  }).pipe(Effect.flatMap(({ message }) => logMsg(message)))

const handleAuthGithubStatus = (cmd: AuthGithubStatusCommand) =>
  apiAuthGithubStatus({ envGlobalPath: cmd.envGlobalPath }).pipe(
    Effect.flatMap(({ message }) => logMsg(message))
  )

const handleAuthGithubLogout = (cmd: AuthGithubLogoutCommand) =>
  apiAuthGithubLogout({ label: cmd.label, envGlobalPath: cmd.envGlobalPath }).pipe(
    Effect.flatMap(({ message }) => logMsg(message))
  )

const handleAuthCodexLogin = (cmd: AuthCodexLoginCommand) =>
  apiAuthCodexLogin({ label: cmd.label, codexAuthPath: cmd.codexAuthPath }).pipe(
    Effect.flatMap(({ message }) => logMsg(message))
  )

const handleAuthCodexStatus = (cmd: AuthCodexStatusCommand) =>
  apiAuthCodexStatus({ label: cmd.label, codexAuthPath: cmd.codexAuthPath }).pipe(
    Effect.flatMap(({ message }) => logMsg(message))
  )

const handleAuthCodexLogout = (cmd: AuthCodexLogoutCommand) =>
  apiAuthCodexLogout({ label: cmd.label, codexAuthPath: cmd.codexAuthPath }).pipe(
    Effect.flatMap(({ message }) => logMsg(message))
  )

const handleAuthClaudeLogin = (cmd: AuthClaudeLoginCommand) =>
  apiAuthClaudeLogin({ label: cmd.label, claudeAuthPath: cmd.claudeAuthPath }).pipe(
    Effect.flatMap(({ message }) => logMsg(message))
  )

const handleAuthClaudeStatus = (cmd: AuthClaudeStatusCommand) =>
  apiAuthClaudeStatus({ label: cmd.label, claudeAuthPath: cmd.claudeAuthPath }).pipe(
    Effect.flatMap(({ message }) => logMsg(message))
  )

const handleAuthClaudeLogout = (cmd: AuthClaudeLogoutCommand) =>
  apiAuthClaudeLogout({ label: cmd.label, claudeAuthPath: cmd.claudeAuthPath }).pipe(
    Effect.flatMap(({ message }) => logMsg(message))
  )

// ─── Sessions / Scrap / MCP / Apply handlers ─────────────────────────────────

// CHANGE: in DinD, fetch project details from API instead of reading local filesystem
// WHY: project config files live on the API host, not visible in the CLI container
// PURITY: SHELL
// INVARIANT: DinD → API path (list + match); local → filesystem path
// CHANGE: match CLI shorthand (e.g. ".docker-git/provercoderai/docker-git") to API project ID
// WHY: CLI resolves to relative path; API uses absolute path; match by suffix
// PURITY: CORE
// COMPLEXITY: O(n) where n = number of projects
const findProjectByShorthand = (shorthand: string) =>
  apiProjectsList().pipe(
    Effect.flatMap(({ projects }) => {
      const normalized = shorthand.replace(/^\.docker-git\//, "")
      const match = projects.find(
        (p) =>
          p.id === shorthand ||
          p.id.endsWith(`/${shorthand}`) ||
          p.id.endsWith(`/${normalized}`) ||
          p.displayName === normalized
      )
      return match
        ? apiProjectGet(match.id)
        : Effect.fail(new ApiClientError({ message: `Project not found: ${shorthand}` }))
    })
  )

const handleAttach = (cmd: AttachCommand) =>
  isInsideDocker()
    ? findProjectByShorthand(cmd.projectDir).pipe(
        Effect.flatMap(({ project }) =>
          attachTmuxFromProject({
            containerName: project.containerName,
            sshUser: project.sshUser,
            sshPort: project.sshPort,
            repoUrl: project.repoUrl,
            repoRef: project.repoRef,
            sshCommand: project.sshCommand
          })
        )
      )
    : attachTmux(cmd)

const handlePanes = (cmd: PanesCommand) => listTmuxPanes(cmd)

const handleSessionsList = (cmd: SessionsListCommand) =>
  apiSessionsList({ projectDir: cmd.projectDir, includeDefault: cmd.includeDefault }).pipe(
    Effect.flatMap(({ output }) => logMsg(output))
  )

const handleSessionsKill = (cmd: SessionsKillCommand) =>
  apiSessionsKill({ projectDir: cmd.projectDir, pid: cmd.pid }).pipe(
    Effect.flatMap(({ output }) => logMsg(output))
  )

const handleApply = (cmd: ApplyCommand) =>
  apiProjectApply(cmd.projectDir, {
    runUp: cmd.runUp,
    gitTokenLabel: cmd.gitTokenLabel,
    codexTokenLabel: cmd.codexTokenLabel,
    claudeTokenLabel: cmd.claudeTokenLabel,
    cpuLimit: cmd.cpuLimit,
    ramLimit: cmd.ramLimit,
    enableMcpPlaywright: cmd.enableMcpPlaywright
  }).pipe(Effect.flatMap(({ containerName }) => Effect.log(`Applied: ${containerName}`)))

const handleSessionsLogs = (cmd: SessionsLogsCommand) =>
  apiSessionsLogs({ projectDir: cmd.projectDir, pid: cmd.pid, lines: cmd.lines }).pipe(
    Effect.flatMap(({ output }) => logMsg(output))
  )

const handleScrapExport = (cmd: ScrapExportCommand) =>
  apiScrapExport({ projectDir: cmd.projectDir, archivePath: cmd.archivePath }).pipe(
    Effect.flatMap(({ output }) => logMsg(output))
  )

const handleScrapImport = (cmd: ScrapImportCommand) =>
  apiScrapImport({ projectDir: cmd.projectDir, archivePath: cmd.archivePath, wipe: cmd.wipe }).pipe(
    Effect.flatMap(({ output }) => logMsg(output))
  )

const handleMcpPlaywrightUp = (cmd: McpPlaywrightUpCommand) =>
  apiMcpPlaywrightUp({ projectDir: cmd.projectDir, runUp: cmd.runUp }).pipe(
    Effect.flatMap(({ output }) => logMsg(output))
  )

// ─── Non-base command dispatcher ─────────────────────────────────────────────

// CHANGE: split into named handlers to satisfy max-lines-per-function
// WHY: each Match.when references a named function; dispatcher stays under 50 lines
// PURITY: SHELL
// INVARIANT: ∀ cmd ∈ NonBaseCommand: exactly one Match.when branch handles cmd
// COMPLEXITY: O(1)
const handleNonBaseCommand = (command: NonBaseCommand) =>
  Match.value(command)
    .pipe(
      Match.when({ _tag: "StatePath" }, handleStatePath),
      Match.when({ _tag: "StateInit" }, handleStateInit),
      Match.when({ _tag: "StateStatus" }, handleStateStatus),
      Match.when({ _tag: "StatePull" }, handleStatePull),
      Match.when({ _tag: "StateCommit" }, handleStateCommit),
      Match.when({ _tag: "StatePush" }, handleStatePush),
      Match.when({ _tag: "StateSync" }, handleStateSync),
      Match.when({ _tag: "AuthGithubLogin" }, handleAuthGithubLogin),
      Match.when({ _tag: "AuthGithubStatus" }, handleAuthGithubStatus),
      Match.when({ _tag: "AuthGithubLogout" }, handleAuthGithubLogout),
      Match.when({ _tag: "AuthCodexLogin" }, handleAuthCodexLogin),
      Match.when({ _tag: "AuthCodexStatus" }, handleAuthCodexStatus),
      Match.when({ _tag: "AuthCodexLogout" }, handleAuthCodexLogout),
      Match.when({ _tag: "AuthClaudeLogin" }, handleAuthClaudeLogin),
      Match.when({ _tag: "AuthClaudeStatus" }, handleAuthClaudeStatus),
      Match.when({ _tag: "AuthClaudeLogout" }, handleAuthClaudeLogout),
      Match.when({ _tag: "Attach" }, handleAttach),
      Match.when({ _tag: "Panes" }, handlePanes),
      Match.when({ _tag: "SessionsList" }, handleSessionsList),
      Match.when({ _tag: "SessionsKill" }, handleSessionsKill)
    )
    .pipe(
      Match.when({ _tag: "Apply" }, handleApply),
      Match.when({ _tag: "SessionsLogs" }, handleSessionsLogs),
      Match.when({ _tag: "ScrapExport" }, handleScrapExport),
      Match.when({ _tag: "ScrapImport" }, handleScrapImport),
      Match.when({ _tag: "McpPlaywrightUp" }, handleMcpPlaywrightUp),
      Match.exhaustive
    )

// ─── Create command handler ───────────────────────────────────────────────────

// CHANGE: extracted to named function to keep program lambda under 50 lines
// WHY: Create is the most complex command (30+ config fields + conditional SSH attach)
// PURITY: SHELL
// INVARIANT: openSsh=true → attachTmux locally after project created on server
const handleCreateCmd = (create: CreateCommand) =>
  apiProjectCreate({
    repoUrl: create.config.repoUrl,
    repoRef: create.config.repoRef,
    targetDir: create.config.targetDir,
    sshPort: String(create.config.sshPort),
    sshUser: create.config.sshUser,
    containerName: create.config.containerName,
    serviceName: create.config.serviceName,
    volumeName: create.config.volumeName,
    authorizedKeysPath: create.config.authorizedKeysPath,
    envGlobalPath: create.config.envGlobalPath,
    envProjectPath: create.config.envProjectPath,
    codexAuthPath: create.config.codexAuthPath,
    codexHome: create.config.codexHome,
    cpuLimit: create.config.cpuLimit,
    ramLimit: create.config.ramLimit,
    dockerNetworkMode: create.config.dockerNetworkMode,
    dockerSharedNetworkName: create.config.dockerSharedNetworkName,
    enableMcpPlaywright: create.config.enableMcpPlaywright,
    outDir: create.outDir,
    gitTokenLabel: create.config.gitTokenLabel,
    codexTokenLabel: create.config.codexAuthLabel,
    claudeTokenLabel: create.config.claudeAuthLabel,
    agentAutoMode: create.config.agentMode,
    up: create.runUp,
    openSsh: false,
    force: create.force,
    forceEnv: create.forceEnv
  }).pipe(
    Effect.flatMap(({ project }) => {
      if (create.openSsh) {
        return attachTmuxFromProject({
          containerName: project.containerName,
          sshUser: project.sshUser,
          sshPort: project.sshPort,
          repoUrl: project.repoUrl,
          repoRef: project.repoRef,
          sshCommand: project.sshCommand
        })
      }
      return Effect.log(`Project created: ${project.displayName} (${project.sshCommand})`)
    })
  )

// ─── Status command handler ───────────────────────────────────────────────────

const handleStatusCmd = () =>
  apiProjectsList().pipe(
    Effect.flatMap(({ projects }) => {
      if (projects.length === 0) {
        return Effect.log("No projects found.")
      }
      const lines = projects.map(
        (p) => `  ${p.displayName} [${p.statusLabel}]  ${p.repoUrl}`
      )
      return Effect.log(lines.join("\n"))
    })
  )

// ─── Program entry point ──────────────────────────────────────────────────────

export const program = pipe(
  readCommand,
  Effect.flatMap((command: Command) =>
    Match.value(command).pipe(
      Match.when({ _tag: "Help" }, ({ message }) => Effect.log(message)),
      Match.when({ _tag: "Create" }, handleCreateCmd),
      Match.when({ _tag: "Status" }, handleStatusCmd),
      Match.when({ _tag: "DownAll" }, () =>
        apiProjectsDownAll().pipe(Effect.flatMap(() => Effect.log("All projects stopped.")))),
      Match.when({ _tag: "Menu" }, () =>
        runMenu),
      Match.orElse((cmd) => handleNonBaseCommand(cmd))
    )
  ),
  Effect.catchTag("ApiClientError", logApiError),
  Effect.matchEffect({
    onFailure: (error) =>
      isParseError(error)
        ? logErrorAndExit(error)
        : pipe(
          Effect.logError(renderError(error)),
          Effect.flatMap(() => Effect.fail(error))
        ),
    onSuccess: () => Effect.void
  }),
  Effect.asVoid
)
