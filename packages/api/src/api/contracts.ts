export type ProjectStatus = "running" | "stopped" | "unknown"

export type AgentProvider = "codex" | "opencode" | "claude" | "custom"

export type AgentStatus = "starting" | "running" | "stopping" | "stopped" | "exited" | "failed"

export type ProjectSummary = {
  readonly id: string
  readonly displayName: string
  readonly repoUrl: string
  readonly repoRef: string
  readonly status: ProjectStatus
  readonly statusLabel: string
}

export type ProjectDetails = ProjectSummary & {
  readonly containerName: string
  readonly serviceName: string
  readonly sshUser: string
  readonly sshPort: number
  readonly targetDir: string
  readonly projectDir: string
  readonly sshCommand: string
  readonly envGlobalPath: string
  readonly envProjectPath: string
  readonly codexAuthPath: string
  readonly codexHome: string
  readonly clonedOnHostname?: string | undefined
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

export type GithubAuthLoginRequest = {
  readonly label?: string | null | undefined
  readonly token?: string | null | undefined
  readonly scopes?: string | null | undefined
}

export type GithubAuthLogoutRequest = {
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

export type CodexAuthLogoutRequest = {
  readonly label?: string | null | undefined
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
  readonly envGlobalPath?: string | undefined
  readonly envProjectPath?: string | undefined
  readonly codexAuthPath?: string | undefined
  readonly codexHome?: string | undefined
  readonly cpuLimit?: string | undefined
  readonly ramLimit?: string | undefined
  readonly dockerNetworkMode?: string | undefined
  readonly dockerSharedNetworkName?: string | undefined
  readonly enableMcpPlaywright?: boolean | undefined
  readonly outDir?: string | undefined
  readonly gitTokenLabel?: string | undefined
  readonly skipGithubAuth?: boolean | undefined
  readonly codexTokenLabel?: string | undefined
  readonly claudeTokenLabel?: string | undefined
  readonly agentAutoMode?: string | undefined
  readonly up?: boolean | undefined
  readonly openSsh?: boolean | undefined
  readonly force?: boolean | undefined
  readonly forceEnv?: boolean | undefined
  readonly waitForClone?: boolean | undefined
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

export type ForgeFedTicket = {
  readonly id: string
  readonly attributedTo: string
  readonly summary: string
  readonly content: string
  readonly mediaType?: string | undefined
  readonly source?: string | undefined
  readonly published?: string | undefined
  readonly updated?: string | undefined
  readonly url?: string | undefined
}

export type FederationIssueStatus = "offered" | "accepted" | "rejected"

export type FederationIssueRecord = {
  readonly issueId: string
  readonly offerId?: string | undefined
  readonly tracker?: string | undefined
  readonly status: FederationIssueStatus
  readonly receivedAt: string
  readonly ticket: ForgeFedTicket
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

export type ActivityPubFollowActivity = {
  readonly "@context": string | ReadonlyArray<string>
  readonly id: string
  readonly type: "Follow"
  readonly actor: string
  readonly object: string
  readonly to?: ReadonlyArray<string> | undefined
  readonly capability?: string | undefined
}

export type ActivityPubPerson = {
  readonly "@context": "https://www.w3.org/ns/activitystreams"
  readonly type: "Person"
  readonly id: string
  readonly name: string
  readonly preferredUsername: string
  readonly summary: string
  readonly inbox: string
  readonly outbox: string
  readonly followers: string
  readonly following: string
  readonly liked: string
}

export type ActivityPubOrderedCollection = {
  readonly "@context": "https://www.w3.org/ns/activitystreams"
  readonly type: "OrderedCollection"
  readonly id: string
  readonly totalItems: number
  readonly orderedItems: ReadonlyArray<unknown>
}

export type FollowSubscription = {
  readonly id: string
  readonly activityId: string
  readonly actor: string
  readonly object: string
  readonly inbox?: string | undefined
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
    readonly kind: "follow.accept"
    readonly subscription: FollowSubscription
  }
  | {
    readonly kind: "follow.reject"
    readonly subscription: FollowSubscription
  }

// CHANGE: add account pool API types for multi-account management
// WHY: expose account pool CRUD and status via the API
// QUOTE(ТЗ): "Сделать возможность регистрировать много аккаунтов"
// REF: issue-213
// PURITY: CORE
// COMPLEXITY: O(1)
export type AccountPoolProvider = "claude" | "codex" | "gemini"

export type AddAccountRequest = {
  readonly provider: AccountPoolProvider
  readonly label: string
}

export type RemoveAccountRequest = {
  readonly provider: AccountPoolProvider
  readonly label: string
}

export type AccountPoolSummary = {
  readonly provider: AccountPoolProvider
  readonly total: number
  readonly available: number
  readonly coolingDown: number
  readonly activeLabel: string | undefined
}

export type ApiEventType =
  | "snapshot"
  | "project.created"
  | "project.deleted"
  | "project.deployment.status"
  | "project.deployment.log"
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
