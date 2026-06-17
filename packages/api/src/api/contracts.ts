import type * as Schema from "effect/Schema"

import type {
  ActivityForgeFedJsonLdContextSchema,
  ActivityPubFollowActivitySchema,
  ForgeFedTicketSchema,
  ForgeFedTicketSourceSchema,
  LocalActivityPubOrderedCollectionSchema
} from "./activitypub-schema.js"

export type ProjectStatus = "running" | "stopped" | "unknown"

export type AgentProvider = "codex" | "opencode" | "claude" | "grok" | "custom"

export type AgentStatus = "starting" | "running" | "stopping" | "stopped" | "exited" | "failed"

export type ProjectSummary = {
  readonly id: string
  readonly projectKey: string
  readonly displayName: string
  readonly repoUrl: string
  readonly repoRef: string
  readonly containerName?: string | undefined
  readonly status: ProjectStatus
  readonly statusLabel: string
  readonly sshSessions: number
  readonly startedAtIso: string | null
  readonly startedAtEpochMs: number | null
  /**
   * Hostname of the machine where the project was originally cloned, when known.
   *
   * @pure true - immutable API DTO field.
   * @effect none
   * @invariant if present, the value was decoded by the API/config hostname schema.
   * @precondition producers omit the field when clone host identity is unknown.
   * @postcondition consumers can group projects by clone-origin host without reading OS state.
   * @complexity O(1)/O(1)
   */
  readonly clonedOnHostname?: string
}

export type ProjectDetails = ProjectSummary & {
  readonly containerName: string
  readonly serviceName: string
  readonly sshUser: string
  readonly sshPort: number
  readonly gpu: "none" | "all"
  readonly targetDir: string
  readonly projectDir: string
  readonly sshCommand: string
  readonly authorizedKeysPath: string
  readonly authorizedKeysExists: boolean
  readonly envGlobalPath: string
  readonly envProjectPath: string
  readonly codexAuthPath: string
  readonly codexHome: string
}

export type CreateProjectAccepted = {
  readonly accepted: true
  readonly projectId: string
  readonly cursor: number
}

export type CreateProjectResult = ProjectDetails | CreateProjectAccepted

export type StartProjectTerminalSessionAccepted = {
  readonly accepted: true
  readonly projectId: string
  readonly cursor: number
  readonly requestId: string
}

export type ProjectPortForwardStatus = "running" | "stopped" | "unknown"

export type ProjectPortForward = {
  readonly id: string
  readonly projectId: string
  readonly projectKey: string
  readonly targetPort: number
  readonly hostPort: number
  readonly bindHost: string
  readonly publicHost: string
  readonly proxyPath: string
  readonly url: string
  readonly status: ProjectPortForwardStatus
  readonly containerName: string
  readonly targetContainerName: string
  readonly createdAt: string | null
}

export type ProjectPortForwardRequest = {
  readonly targetPort: number
  readonly hostPort?: number | undefined
}

export type PanelCloudflareTunnelStatus = "starting" | "running" | "stopped" | "failed"

export type PanelCloudflareTunnelSession = {
  readonly error: string | null
  readonly id: string
  readonly logTail: ReadonlyArray<string>
  readonly panelUrl: string
  readonly publicUrl: string | null
  readonly startedAt: string
  readonly status: PanelCloudflareTunnelStatus
  readonly stoppedAt: string | null
}

export type StartPanelCloudflareTunnelRequest = {
  readonly panelUrl: string
}

export type ProjectBrowserStatus = "running" | "stopped" | "missing" | "unknown"

export type ProjectBrowserSession = {
  readonly projectId: string
  readonly projectKey: string
  readonly containerName: string
  readonly status: ProjectBrowserStatus
  readonly noVncPath: string
  readonly noVncUrl: string
  readonly cdpPath: string
  readonly cdpUrl: string
}

export type ProjectDatabaseEngine = "postgres" | "mysql" | "mariadb"

export type ProjectDatabaseProfile = {
  readonly createdAt: string
  readonly database: string
  readonly engine: ProjectDatabaseEngine
  readonly host: string
  readonly id: string
  readonly label: string
  readonly maskedConnectionString: string
  readonly port: number
  readonly updatedAt: string
  readonly user: string
}

export type ProjectDatabaseProfileRequest = {
  readonly connectionString: string
  readonly label?: string | null | undefined
}

export type ProjectDatabaseSessionStatus = "running" | "stopped" | "missing" | "unknown"

export type ProjectDatabaseSession = {
  readonly configHash: string
  readonly containerName: string
  readonly editorPath: string
  readonly editorUrl: string
  readonly projectId: string
  readonly projectKey: string
  readonly status: ProjectDatabaseSessionStatus
}

export type ProjectDatabaseForwardStatus = "running" | "stopped" | "unknown"

export type ProjectDatabaseForward = {
  readonly bindHost: string
  readonly containerName: string
  readonly createdAt: string | null
  readonly database: string
  readonly engine: ProjectDatabaseEngine
  readonly externalConnectionString: string
  readonly hostPort: number
  readonly id: string
  readonly maskedExternalConnectionString: string
  readonly profileId: string
  readonly profileLabel: string
  readonly projectId: string
  readonly projectKey: string
  readonly publicHost: string
  readonly status: ProjectDatabaseForwardStatus
  readonly targetHost: string
  readonly targetPort: number
}

export type GithubAuthTokenStatus = {
  readonly key: string
  readonly label: string
  readonly status: "valid" | "invalid" | "unknown"
  readonly login: string | null
}

export type GithubAuthStatus = {
  readonly summary: string
  readonly tokens: ReadonlyArray<GithubAuthTokenStatus>
}

export type GitlabAuthTokenStatus = {
  readonly key: string
  readonly label: string
  readonly status: "valid" | "invalid" | "unknown"
  readonly login: string | null
}

export type GitlabAuthStatus = {
  readonly summary: string
  readonly tokens: ReadonlyArray<GitlabAuthTokenStatus>
}

export type GitAuthConnectionStatus = {
  readonly host: string
  readonly user: string
}

export type GitAuthStatus = {
  readonly summary: string
  readonly connections: ReadonlyArray<GitAuthConnectionStatus>
}

export type GitAuthLoginRequest = {
  readonly host: string
  readonly token?: string | null | undefined
  readonly user?: string | null | undefined
}

export type GitAuthLogoutRequest = {
  readonly host: string
}

export type GithubAuthLoginRequest = {
  readonly label?: string | null | undefined
  readonly token?: string | null | undefined
  readonly scopes?: string | null | undefined
}

export type GitlabAuthLoginRequest = {
  readonly label?: string | null | undefined
  readonly token?: string | null | undefined
}

export type AuthMenuFlow =
  | "GithubRemove"
  | "GitSet"
  | "GitRemove"
  | "ClaudeLogout"
  | "GeminiApiKey"
  | "GeminiLogout"
  | "GrokApiKey"
  | "GrokLogout"

export type AuthTerminalFlow = "ClaudeOauth" | "GeminiOauth" | "GrokOauth"

export type AuthSnapshot = {
  readonly globalEnvPath: string
  readonly claudeAuthPath: string
  readonly codexAuthPath: string
  readonly geminiAuthPath: string
  readonly grokAuthPath: string
  readonly totalEntries: number
  readonly githubTokenEntries: number
  readonly gitTokenEntries: number
  readonly gitUserEntries: number
  readonly claudeAuthEntries: number
  readonly codexAuthEntries: number
  readonly geminiAuthEntries: number
  readonly grokAuthEntries: number
}

export type AuthMenuRequest = {
  readonly flow: AuthMenuFlow
  readonly label?: string | null | undefined
  readonly token?: string | null | undefined
  readonly user?: string | null | undefined
  readonly apiKey?: string | null | undefined
}

export type AuthTerminalSessionRequest = {
  readonly flow: AuthTerminalFlow
  readonly label?: string | null | undefined
}

export type GithubAuthLogoutRequest = {
  readonly label?: string | null | undefined
}

export type GitlabAuthLogoutRequest = {
  readonly label?: string | null | undefined
}

export type CodexAuthImportRequest = {
  readonly label?: string | null | undefined
  readonly authText: string
}

export type CodexAuthLoginRequest = {
  readonly label?: string | null | undefined
}

export type CodexAuthStatus = {
  readonly label: string
  readonly message: string
  readonly present: boolean
  readonly authPath: string
  readonly account: string | null
}

export type GrokAuthStatus = {
  readonly label: string
  readonly message: string
  readonly connected: boolean
  readonly authPath: string
  readonly method: "none" | "api-key" | "oauth"
}

export type GrokAuthLogoutRequest = {
  readonly label?: string | null | undefined
}

export type CodexAuthLogoutRequest = {
  readonly label?: string | null | undefined
}

export type ProjectAuthFlow =
  | "ProjectGithubConnect"
  | "ProjectGithubDisconnect"
  | "ProjectGitConnect"
  | "ProjectGitDisconnect"
  | "ProjectClaudeConnect"
  | "ProjectClaudeDisconnect"
  | "ProjectGeminiConnect"
  | "ProjectGeminiDisconnect"
  | "ProjectGrokConnect"
  | "ProjectGrokDisconnect"

export type ProjectAuthSnapshot = {
  readonly projectDir: string
  readonly projectName: string
  readonly envGlobalPath: string
  readonly envProjectPath: string
  readonly claudeAuthPath: string
  readonly geminiAuthPath: string
  readonly grokAuthPath: string
  readonly githubTokenEntries: number
  readonly gitTokenEntries: number
  readonly claudeAuthEntries: number
  readonly geminiAuthEntries: number
  readonly grokAuthEntries: number
  readonly activeGithubLabel: string | null
  readonly activeGitLabel: string | null
  readonly activeClaudeLabel: string | null
  readonly activeGeminiLabel: string | null
  readonly activeGrokLabel: string | null
}

export type ProjectAuthRequest = {
  readonly flow: ProjectAuthFlow
  readonly label?: string | null | undefined
}

export type ProjectPromptKind = "claude" | "codex" | "gemini" | "grok"

export type ProjectPromptFile = {
  readonly kind: ProjectPromptKind
  readonly fileName: string
  readonly relativePath: string
  readonly absolutePath: string
  readonly exists: boolean
  readonly bytes: number
  readonly content: string
}

export type ProjectPromptsSnapshot = {
  readonly projectId: string
  readonly projectKey: string
  readonly projectDir: string
  readonly prompts: ReadonlyArray<ProjectPromptFile>
}

export type ProjectPromptUpdateRequest = {
  readonly content: string
}

export type ProjectSkillScope =
  | "skills"
  | "agents/skills"
  | "agents/.skills"
  | "claude/skills"
  | "codex/skills"
  | "gemini/skills"
  | "grok/skills"

export type ProjectSkillFile = {
  readonly id: string
  readonly scope: ProjectSkillScope
  readonly name: string
  readonly relativePath: string
  readonly absolutePath: string
  readonly bytes: number
  readonly content: string
  readonly updatedAtIso: string | null
}

export type ProjectSkillScopeInfo = {
  readonly scope: ProjectSkillScope
  readonly relativeRoot: string
  readonly absoluteRoot: string
}

export type ProjectSkillsSnapshot = {
  readonly projectId: string
  readonly projectKey: string
  readonly projectDir: string
  readonly skills: ReadonlyArray<ProjectSkillFile>
  readonly scopes: ReadonlyArray<ProjectSkillScopeInfo>
}

export type ProjectSkillUpdateRequest = {
  readonly scope: ProjectSkillScope
  readonly name: string
  readonly content: string
}

export type StateInitRequest = {
  readonly repoUrl: string
  readonly repoRef?: string | undefined
}

export type StateCommitRequest = {
  readonly message: string
}

export type StateSyncRequest = {
  readonly message?: string | null | undefined
}

export type ApplyAllRequest = {
  readonly activeOnly?: boolean | undefined
}

export type UpProjectRequest = {
  readonly authorizedKeysContents?: string | undefined
  readonly useManagedAuthorizedKeys?: boolean | undefined
}

export type ApplyProjectRequest = {
  readonly cpuLimit?: string | undefined
  readonly ramLimit?: string | undefined
  readonly playwrightCpuLimit?: string | undefined
  readonly playwrightRamLimit?: string | undefined
  readonly gpu?: "none" | "all" | undefined
}

export type ApiAuthRequired = {
  readonly provider: "github"
  readonly message: string
  readonly command: string
}

export type CreateProjectRequest = {
  readonly repoUrl?: string | undefined
  readonly repoRef?: string | undefined
  readonly targetDir?: string | undefined
  readonly sshPort?: string | undefined
  readonly sshUser?: string | undefined
  readonly containerName?: string | undefined
  readonly serviceName?: string | undefined
  readonly volumeName?: string | undefined
  readonly secretsRoot?: string | undefined
  readonly authorizedKeysPath?: string | undefined
  readonly authorizedKeysContents?: string | undefined
  readonly useManagedAuthorizedKeys?: boolean | undefined
  readonly envGlobalPath?: string | undefined
  readonly envProjectPath?: string | undefined
  readonly codexAuthPath?: string | undefined
  readonly codexHome?: string | undefined
  readonly cpuLimit?: string | undefined
  readonly ramLimit?: string | undefined
  readonly playwrightCpuLimit?: string | undefined
  readonly playwrightRamLimit?: string | undefined
  readonly gpu?: "none" | "all" | undefined
  readonly dockerNetworkMode?: string | undefined
  readonly dockerSharedNetworkName?: string | undefined
  readonly enableMcpPlaywright?: boolean | undefined
  readonly outDir?: string | undefined
  readonly gitTokenLabel?: string | undefined
  readonly skipGithubAuth?: boolean | undefined
  readonly codexTokenLabel?: string | undefined
  readonly claudeTokenLabel?: string | undefined
  readonly geminiTokenLabel?: string | undefined
  readonly grokTokenLabel?: string | undefined
  readonly agentAutoMode?: string | undefined
  readonly up?: boolean | undefined
  readonly openSsh?: boolean | undefined
  readonly force?: boolean | undefined
  readonly forceEnv?: boolean | undefined
  readonly waitForClone?: boolean | undefined
  readonly async?: boolean | undefined
  /**
   * Hostname of the machine where the project was cloned.
   *
   * CHANGE: add explicit clone-origin hostname to the create-project contract.
   * WHY: keeps command builders pure by passing host identity as immutable input instead of reading OS state.
   * QUOTE(ТЗ): "CORE: Исключительно чистые функции, неизменяемые данные, математические операции"
   * REF: pr-420-coderabbit-review-4518791377
   * SOURCE: n/a
   * FORMAT THEOREM: ∀h ∈ Hostname: request(h) -> build(request).config.clonedOnHostname = h
   * PURITY: CORE - immutable request data.
   * @pure true - immutable API request DTO field.
   * @effect none
   * INVARIANT: if present, value satisfies API HostnameSchema.
   * @precondition callers omit the field when clone host identity is unknown.
   * @postcondition command builders receive host identity as data, not by reading OS state.
   * COMPLEXITY: O(1)/O(1)
   */
  readonly clonedOnHostname?: string
}

export type AgentEnvVar = {
  readonly key: string
  readonly value: string
}

export type CreateAgentRequest = {
  readonly provider: AgentProvider
  readonly command?: string | undefined
  readonly args?: ReadonlyArray<string> | undefined
  readonly cwd?: string | undefined
  readonly env?: ReadonlyArray<AgentEnvVar> | undefined
  readonly label?: string | undefined
}

export type AgentSession = {
  readonly id: string
  readonly projectId: string
  readonly provider: AgentProvider
  readonly label: string
  readonly command: string
  readonly containerName: string
  readonly status: AgentStatus
  readonly source: string
  readonly pidFile: string
  readonly hostPid: number | null
  readonly startedAt: string
  readonly updatedAt: string
  readonly stoppedAt?: string | undefined
  readonly exitCode?: number | undefined
  readonly signal?: string | undefined
}

export type AgentLogLine = {
  readonly at: string
  readonly stream: "stdout" | "stderr"
  readonly line: string
}

export type AgentAttachInfo = {
  readonly projectId: string
  readonly agentId: string
  readonly containerName: string
  readonly pidFile: string
  readonly inspectCommand: string
  readonly shellCommand: string
}

export type TerminalSessionStatus = "ready" | "attached" | "exited" | "failed"

export type TerminalSession = {
  readonly id: string
  readonly projectId: string
  readonly sshCommand: string
  readonly status: TerminalSessionStatus
  readonly createdAt: string
  readonly attachedClients?: number | undefined
  readonly startedAt?: string | undefined
  readonly closedAt?: string | undefined
  readonly exitCode?: number | undefined
  readonly signal?: number | undefined
}

export type ContainerTaskKind = "ssh" | "web-terminal" | "agent" | "background" | "system"

export type ContainerTask = {
  readonly pid: number
  readonly ppid: number
  readonly user: string
  readonly tty: string
  readonly etime: string
  readonly etimes: number
  readonly command: string
  readonly kind: ContainerTaskKind
  readonly managedId?: string | undefined
  readonly logAvailable: boolean
}

export type ContainerTaskSnapshot = {
  readonly projectId: string
  readonly containerName: string
  readonly generatedAt: string
  readonly sshConnections: number
  readonly tasks: ReadonlyArray<ContainerTask>
  readonly terminalSessions: ReadonlyArray<TerminalSession>
  readonly agents: ReadonlyArray<AgentSession>
}

export const activityStreamsJsonLdContext = "https://www.w3.org/ns/activitystreams" as const
export const forgeFedJsonLdContext = "https://forgefed.org/ns" as const
export const securityJsonLdContext = "https://w3id.org/security/v1" as const
export const activityForgeFedJsonLdContext = [
  activityStreamsJsonLdContext,
  forgeFedJsonLdContext
] as const
export const actorJsonLdContext = [
  activityStreamsJsonLdContext,
  securityJsonLdContext
] as const
export const federationJsonLdContentType =
  `application/ld+json; profile="${activityStreamsJsonLdContext}"` as const
export const federationJsonLdResponseContentType =
  `${federationJsonLdContentType}; charset=utf-8` as const

export type ActivityForgeFedJsonLdContext = Schema.Schema.Type<typeof ActivityForgeFedJsonLdContextSchema>

export type ForgeFedTicket = Schema.Schema.Type<typeof ForgeFedTicketSchema>

export type ForgeFedTicketSource = Schema.Schema.Type<typeof ForgeFedTicketSourceSchema>

export type FederationIssueStatus =
  | "offered"
  | "accepted"
  | "rejected"
  | "queued"
  | "running"
  | "completed"
  | "failed"

export type FederationIssueRecord = {
  readonly issueId: string
  readonly offerId?: string | undefined
  readonly activityId?: string | undefined
  readonly actor?: string | undefined
  readonly tracker?: string | undefined
  readonly status: FederationIssueStatus
  readonly receivedAt: string
  readonly updatedAt?: string | undefined
  readonly ticket: ForgeFedTicket
  readonly projectId?: string | undefined
  readonly agentId?: string | undefined
  readonly remoteInbox?: string | undefined
  readonly remoteOutbox?: string | undefined
  readonly result?: string | undefined
  readonly error?: string | undefined
}

export type CreateFollowRequest = {
  readonly actor?: string | undefined
  readonly object: string
  readonly domain?: string | undefined
  readonly inbox?: string | undefined
  readonly to?: ReadonlyArray<string> | undefined
  readonly capability?: string | undefined
}

export type FollowStatus = "pending" | "accepted" | "rejected"

export type ActivityPubFollowActivity = Schema.Schema.Type<typeof ActivityPubFollowActivitySchema>

export type LocalActivityPubOrderedCollection = Schema.Schema.Type<typeof LocalActivityPubOrderedCollectionSchema>

export type FollowSubscription = {
  readonly id: string
  readonly activityId: string
  readonly actor: string
  readonly object: string
  readonly inbox?: string | undefined
  readonly remoteActor?: string | undefined
  readonly remoteInbox?: string | undefined
  readonly remoteOutbox?: string | undefined
  readonly remoteFollowers?: string | undefined
  readonly remoteSharedInbox?: string | undefined
  readonly remotePublicKeyId?: string | undefined
  readonly remotePublicKeyPem?: string | undefined
  readonly subscriptionName?: string | undefined
  readonly queue?: string | undefined
  readonly projectRepoUrl?: string | undefined
  readonly agentProvider?: AgentProvider | undefined
  readonly agentCommand?: string | undefined
  readonly to: ReadonlyArray<string>
  readonly capability?: string | undefined
  status: FollowStatus
  readonly createdAt: string
  updatedAt: string
  readonly activity: ActivityPubFollowActivity
}

export type FollowSubscriptionCreated = {
  readonly subscription: FollowSubscription
  readonly activity: ActivityPubFollowActivity
}

export type FederationInboxResult =
  | {
    readonly kind: "issue.offer"
    readonly issue: FederationIssueRecord
  }
  | {
    readonly kind: "issue.ticket"
    readonly issue: FederationIssueRecord
  }
  | {
    readonly kind: "issue.create"
    readonly issue: FederationIssueRecord
  }
  | {
    readonly kind: "follow.accept"
    readonly subscription: FollowSubscription
  }
  | {
    readonly kind: "follow.reject"
    readonly subscription: FollowSubscription
  }

export type ExchangeSubscribeRequest = {
  readonly target: string
  readonly domain?: string | undefined
  readonly actor?: string | undefined
  readonly inbox?: string | undefined
  readonly projectRepoUrl?: string | undefined
  readonly agentProvider?: AgentProvider | undefined
  readonly agentCommand?: string | undefined
}

export type ExchangePollRequest = {
  readonly target?: string | undefined
  readonly runTasks?: boolean | undefined
}

export type ExchangePollResult = {
  readonly polledAt: string
  readonly subscriptions: number
  readonly totalItems: number
  readonly newItems: number
  readonly processedItems: number
  readonly failedItems: number
}

export type FederationExchangeEventKind =
  | "follow.sent"
  | "inbox.follow.accept"
  | "inbox.follow.reject"
  | "inbox.issue.received"
  | "poll.completed"

export type FederationExchangeEvent = {
  readonly id: string
  readonly kind: FederationExchangeEventKind
  readonly occurredAt: string
  readonly subscriptionId?: string | undefined
  readonly target?: string | undefined
  readonly queue?: string | undefined
  readonly status?: FollowStatus | undefined
  readonly issueId?: string | undefined
  readonly remoteActor?: string | undefined
  readonly totalItems?: number | undefined
  readonly newItems?: number | undefined
  readonly processedItems?: number | undefined
  readonly failedItems?: number | undefined
}

export type FederationExchangeStatusSubscription = {
  readonly id: string
  readonly target: string
  readonly queue?: string | undefined
  readonly status: FollowStatus
  readonly remoteActor?: string | undefined
  readonly remoteInbox?: string | undefined
  readonly remoteOutbox?: string | undefined
  readonly createdAt: string
  readonly updatedAt: string
}

export type FederationExchangeStatus = {
  readonly publicActor: string
  readonly summary: {
    readonly subscriptions: number
    readonly accepted: number
    readonly pending: number
    readonly rejected: number
    readonly issues: number
    readonly processedOutboxItems: number
    readonly lastInboxAt?: string | undefined
    readonly lastPollAt?: string | undefined
  }
  readonly subscriptions: ReadonlyArray<FederationExchangeStatusSubscription>
  readonly recentEvents: ReadonlyArray<FederationExchangeEvent>
}

export type ApiEventType =
  | "snapshot"
  | "project.created"
  | "project.deleted"
  | "project.deployment.status"
  | "project.deployment.log"
  | "project.ssh.session"
  | "agent.started"
  | "agent.output"
  | "agent.exited"
  | "agent.stopped"
  | "agent.error"

export type ApiEvent = {
  readonly seq: number
  readonly projectId: string
  readonly type: ApiEventType
  readonly at: string
  readonly payload: unknown
}
