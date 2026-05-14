import type { JSX } from "react"

import { authMenuActionByIndex, authMenuLabels } from "./auth-flow.js"
import type { ActionPromptState } from "./action-prompt.js"
import type { AuthSnapshot, GithubAuthStatus } from "./api.js"
import { Box, Text } from "./elements.js"
import { ActionLine, ActionPromptPanel, SnapshotLine } from "./panel-auth-shared.js"

const actionHint = (action: string | null): string | undefined => {
  if (action === "ClaudeOauth" || action === "GeminiOauth") {
    return "opens embedded terminal"
  }
  if (action === "GithubOauth") {
    return "controller web login"
  }
  return undefined
}

const buildActionHintProps = (index: number): { readonly hint?: string } => {
  const hint = actionHint(authMenuActionByIndex(index))
  return hint === undefined ? {} : { hint }
}

const GithubStatusSection = ({ githubStatus }: { readonly githubStatus: GithubAuthStatus | null }): JSX.Element => (
  <Box flexDirection="column" marginTop={1}>
    <Text bold={true} fg="#f6fbff">GitHub status</Text>
    <Text fg="#7fdfff">{githubStatus?.summary ?? "GitHub status not loaded yet."}</Text>
    {(githubStatus?.tokens ?? []).map((token) => (
      <Text key={token.key} fg="#d6e5f7">
        {token.label}: {token.status}
        {token.login === null ? "" : ` (${token.login})`}
      </Text>
    ))}
  </Box>
)

const AuthActionList = ({ onRunAuthAction }: { readonly onRunAuthAction: (index: number) => void }): JSX.Element => (
  <Box flexDirection="column" marginTop={1}>
    {authMenuLabels().map((label, index) => (
      <ActionLine
        key={`${index}-${label}`}
        label={label}
        onClick={() => {
          onRunAuthAction(index)
        }}
        {...buildActionHintProps(index)}
      />
    ))}
  </Box>
)

export const AuthPanel = (
  {
    actionPrompt,
    githubStatus,
    onActionPromptCancel,
    onActionPromptChange,
    onActionPromptSubmit,
    onRunAuthAction,
    snapshot
  }: {
    readonly actionPrompt: ActionPromptState | null
    readonly githubStatus: GithubAuthStatus | null
    readonly onActionPromptCancel: () => void
    readonly onActionPromptChange: (key: string, value: string) => void
    readonly onActionPromptSubmit: () => void
    readonly onRunAuthAction: (index: number) => void
    readonly snapshot: AuthSnapshot | null
  }
): JSX.Element => (
  <Box flexDirection="column">
    <Text bold={true} fg="#8be9fd">Auth profiles (keys)</Text>
    {snapshot === null
      ? <Text fg="#9fb8d5">Нажми Enter или кликни Refresh, чтобы загрузить snapshot.</Text>
      : (
        <Box flexDirection="column" marginTop={1}>
          <SnapshotLine label="env" value={snapshot.globalEnvPath} />
          <SnapshotLine label="GitHub tokens" value={snapshot.githubTokenEntries} />
          <SnapshotLine label="Git tokens" value={snapshot.gitTokenEntries} />
          <SnapshotLine label="Git users" value={snapshot.gitUserEntries} />
          <SnapshotLine label="Claude accounts" value={snapshot.claudeAuthEntries} />
          <SnapshotLine label="Gemini accounts" value={snapshot.geminiAuthEntries} />
        </Box>
      )}
    <GithubStatusSection githubStatus={githubStatus} />
    {actionPrompt === null
      ? <AuthActionList onRunAuthAction={onRunAuthAction} />
      : (
        <ActionPromptPanel
          actionPrompt={actionPrompt}
          onActionPromptCancel={onActionPromptCancel}
          onActionPromptChange={onActionPromptChange}
          onActionPromptSubmit={onActionPromptSubmit}
        />
      )}
  </Box>
)
