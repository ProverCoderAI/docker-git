import { type JSX, useEffect, useState } from "react"

import { Box, Text, TextInput } from "../ui/primitives.js"
import type { ProjectPromptFile, ProjectPromptKind, ProjectPromptsSnapshot, ProjectSummary } from "./api.js"

type PromptsPanelProps = {
  readonly onDeletePrompt: (kind: ProjectPromptKind) => void
  readonly onRefreshPrompts: () => void
  readonly onSavePrompt: (kind: ProjectPromptKind, content: string) => void
  readonly selectedProjectSummary: ProjectSummary | undefined
  readonly snapshot: ProjectPromptsSnapshot | null
}

const promptTitleByKind: Record<ProjectPromptKind, string> = {
  claude: "Claude (CLAUDE.md)",
  codex: "Codex / Agents (AGENTS.md)",
  gemini: "Gemini (GEMINI.md)",
  grok: "Grok (GROK.md)"
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  return `${(bytes / 1024).toFixed(1)} KB`
}

const PromptEditorHeader = ({ prompt }: { readonly prompt: ProjectPromptFile }): JSX.Element => (
  <Box alignItems="center" flexWrap="wrap" gap={1} justifyContent="space-between">
    <Text bold={true} fg="#d6e5f7">{promptTitleByKind[prompt.kind]}</Text>
    <Text fg={prompt.exists ? "#56f39a" : "#8fa6c4"}>
      {prompt.exists ? `${formatBytes(prompt.bytes)} on disk` : "not created yet"}
    </Text>
  </Box>
)

const PromptEditorActions = (
  {
    dirty,
    exists,
    onDelete,
    onSave
  }: {
    readonly dirty: boolean
    readonly exists: boolean
    readonly onDelete: () => void
    readonly onSave: () => void
  }
): JSX.Element => (
  <Box flexWrap="wrap" gap={1}>
    <Box onClick={onSave} width="auto">
      <Text bold={true} fg={dirty ? "#78f0a3" : "#8fa6c4"}>Save</Text>
    </Box>
    {exists
      ? (
        <Box onClick={onDelete} width="auto">
          <Text bold={true} fg="#ff8aa0">Delete</Text>
        </Box>
      )
      : null}
    <Text fg="#8fa6c4">Tip: Cmd/Ctrl+Enter saves.</Text>
  </Box>
)

const usePromptDraft = (prompt: ProjectPromptFile) => {
  const [draft, setDraft] = useState(prompt.content)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setDraft(prompt.content)
    setDirty(false)
  }, [prompt.absolutePath, prompt.bytes, prompt.content])

  const handleChange = (value: string) => {
    setDraft(value)
    setDirty(value !== prompt.content)
  }

  return { dirty, draft, handleChange }
}

const PromptEditor = (
  {
    onDelete,
    onSave,
    prompt
  }: {
    readonly onDelete: () => void
    readonly onSave: (content: string) => void
    readonly prompt: ProjectPromptFile
  }
): JSX.Element => {
  const { dirty, draft, handleChange } = usePromptDraft(prompt)
  const handleSave = () => {
    onSave(draft)
  }

  return (
    <Box border={true} borderColor="#3a4652" flexDirection="column" gap={1} padding={1}>
      <PromptEditorHeader prompt={prompt} />
      <Text fg="#8fa6c4" wrap="truncate">{prompt.absolutePath}</Text>
      <TextInput
        ariaLabel={`${promptTitleByKind[prompt.kind]} editor`}
        minRows={10}
        multiline={true}
        onChange={handleChange}
        onEnter={handleSave}
        placeholder={`Write your ${prompt.fileName} content here…`}
        value={draft}
      />
      <PromptEditorActions dirty={dirty} exists={prompt.exists} onDelete={onDelete} onSave={handleSave} />
    </Box>
  )
}

export const ProjectPromptsPanel = (
  {
    onDeletePrompt,
    onRefreshPrompts,
    onSavePrompt,
    selectedProjectSummary,
    snapshot
  }: PromptsPanelProps
): JSX.Element => (
  <Box flexDirection="column" gap={1}>
    <Text bold={true} fg="#8be9fd">Project system prompts</Text>
    <Text fg="#d6e5f7" wrap="wrap">
      Edit per-project system prompts that agents read on startup: CLAUDE.md (Claude), AGENTS.md (Codex / generic
      agents), GEMINI.md (Gemini), GROK.md (Grok).
    </Text>
    <Text fg="#8fa6c4" wrap="truncate">
      Project: {selectedProjectSummary?.displayName ?? "not selected"}
    </Text>
    <Text fg="#8fa6c4" wrap="truncate">
      {snapshot === null ? "Loading prompts…" : `Directory: ${snapshot.projectDir}`}
    </Text>
    <Box flexWrap="wrap" gap={1}>
      <Box onClick={onRefreshPrompts} width="auto">
        <Text bold={true} fg="#7fdfff">refresh</Text>
      </Box>
    </Box>
    {snapshot === null
      ? <Text fg="#8fa6c4">No prompt data yet.</Text>
      : (
        <Box flexDirection="column" gap={1} marginTop={1}>
          {snapshot.prompts.map((prompt) => (
            <PromptEditor
              key={prompt.kind}
              onDelete={() => {
                onDeletePrompt(prompt.kind)
              }}
              onSave={(content) => {
                onSavePrompt(prompt.kind, content)
              }}
              prompt={prompt}
            />
          ))}
        </Box>
      )}
  </Box>
)
