import type { JSX } from "react"

import { projectAuthMenuLabels } from "../docker-git/menu-project-auth-shared.js"
import type { ActionPromptState } from "./action-prompt.js"
import type { ProjectAuthSnapshot } from "./api.js"
import { Box, Text } from "./elements.js"
import { ActionLine, ActionPromptPanel, SnapshotLine } from "./panel-auth-shared.js"

const ProjectAuthActionList = (
  { onRunProjectAuthAction }: { readonly onRunProjectAuthAction: (index: number) => void }
): JSX.Element => (
  <Box flexDirection="column" marginTop={1}>
    {projectAuthMenuLabels().map((label, index) => (
      <ActionLine
        key={`${index}-${label}`}
        label={label}
        onClick={() => {
          onRunProjectAuthAction(index)
        }}
      />
    ))}
  </Box>
)

const ProjectAuthSnapshotSection = ({ snapshot }: { readonly snapshot: ProjectAuthSnapshot | null }): JSX.Element =>
  snapshot === null
    ? <Text fg="#9fb8d5">Loading project-auth snapshot...</Text>
    : (
      <Box flexDirection="column" marginTop={1}>
        <SnapshotLine label="project" value={snapshot.projectName} />
        <SnapshotLine label="project env" value={snapshot.envProjectPath} />
        <SnapshotLine label="GitHub tokens" value={snapshot.githubTokenEntries} />
        <SnapshotLine label="Git tokens" value={snapshot.gitTokenEntries} />
        <SnapshotLine label="GitHub label" value={snapshot.activeGithubLabel ?? "not set"} />
        <SnapshotLine label="Git label" value={snapshot.activeGitLabel ?? "not set"} />
        <SnapshotLine label="Claude label" value={snapshot.activeClaudeLabel ?? "not set"} />
        <SnapshotLine label="Gemini label" value={snapshot.activeGeminiLabel ?? "not set"} />
        <SnapshotLine label="Grok label" value={snapshot.activeGrokLabel ?? "not set"} />
        <SnapshotLine label="Grok accounts" value={snapshot.grokAuthEntries} />
      </Box>
    )

const ProjectAuthEmptyState = (): JSX.Element => (
  <Box flexDirection="column" marginTop={1}>
    <Text fg="#d6e5f7">No project selected.</Text>
    <Text fg="#8fa6c4">Open Select first, connect or choose a project there, then return here.</Text>
  </Box>
)

type ProjectAuthPanelProps = {
  readonly actionPrompt: ActionPromptState | null
  readonly onActionPromptCancel: () => void
  readonly onActionPromptChange: (key: string, value: string) => void
  readonly onActionPromptSubmit: () => void
  readonly onRunProjectAuthAction: (index: number) => void
  readonly selectedProjectName: string | null
  readonly snapshot: ProjectAuthSnapshot | null
}

const renderProjectAuthBody = ({
  actionPrompt,
  onActionPromptCancel,
  onActionPromptChange,
  onActionPromptSubmit,
  onRunProjectAuthAction,
  selectedProjectName,
  snapshot
}: ProjectAuthPanelProps): JSX.Element => {
  if (selectedProjectName === null) {
    return <ProjectAuthEmptyState />
  }
  if (actionPrompt !== null) {
    return (
      <ActionPromptPanel
        actionPrompt={actionPrompt}
        onActionPromptCancel={onActionPromptCancel}
        onActionPromptChange={onActionPromptChange}
        onActionPromptSubmit={onActionPromptSubmit}
      />
    )
  }
  return (
    <>
      <ProjectAuthSnapshotSection snapshot={snapshot} />
      <ProjectAuthActionList onRunProjectAuthAction={onRunProjectAuthAction} />
    </>
  )
}

export const ProjectAuthPanel = (props: ProjectAuthPanelProps): JSX.Element => (
  <Box flexDirection="column">
    <Text bold={true} fg="#8be9fd">Project auth (bind labels)</Text>
    {renderProjectAuthBody(props)}
  </Box>
)
