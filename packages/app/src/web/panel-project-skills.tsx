import { type JSX, useEffect, useMemo, useState } from "react"

import { Box, Text, TextInput } from "../ui/primitives.js"
import type {
  ProjectSkillFile,
  ProjectSkillScope,
  ProjectSkillScopeInfo,
  ProjectSkillsSnapshot,
  ProjectSummary
} from "./api.js"

type SkillsPanelProps = {
  readonly onDeleteSkill: (scope: ProjectSkillScope, name: string) => void
  readonly onRefreshSkills: () => void
  readonly onSaveSkill: (scope: ProjectSkillScope, name: string, content: string) => void
  readonly selectedProjectSummary: ProjectSummary | undefined
  readonly snapshot: ProjectSkillsSnapshot | null
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  return `${(bytes / 1024).toFixed(1)} KB`
}

const formatUpdated = (updatedAtIso: string | null): string => {
  if (updatedAtIso === null) {
    return "—"
  }
  const date = new Date(updatedAtIso)
  if (Number.isNaN(date.getTime())) {
    return updatedAtIso
  }
  return date.toLocaleString()
}

const SkillEditorHeader = ({ skill }: { readonly skill: ProjectSkillFile }): JSX.Element => (
  <>
    <Box alignItems="center" flexWrap="wrap" gap={1} justifyContent="space-between">
      <Text bold={true} fg="#d6e5f7">{skill.name}</Text>
      <Text fg="#8fa6c4">{skill.scope} · {formatBytes(skill.bytes)}</Text>
    </Box>
    <Text fg="#8fa6c4" wrap="truncate">{skill.relativePath}</Text>
    <Text fg="#8fa6c4">Updated: {formatUpdated(skill.updatedAtIso)}</Text>
  </>
)

const SkillEditorActions = (
  {
    dirty,
    onDelete,
    onSave
  }: {
    readonly dirty: boolean
    readonly onDelete: () => void
    readonly onSave: () => void
  }
): JSX.Element => (
  <Box flexWrap="wrap" gap={1}>
    <Box onClick={onSave} width="auto">
      <Text bold={true} fg={dirty ? "#78f0a3" : "#8fa6c4"}>Save</Text>
    </Box>
    <Box onClick={onDelete} width="auto">
      <Text bold={true} fg="#ff8aa0">Delete</Text>
    </Box>
    <Text fg="#8fa6c4">Tip: Cmd/Ctrl+Enter saves.</Text>
  </Box>
)

const useSkillDraft = (skill: ProjectSkillFile) => {
  const [draft, setDraft] = useState(skill.content)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setDraft(skill.content)
    setDirty(false)
  }, [skill.absolutePath, skill.bytes, skill.content])

  const handleChange = (value: string) => {
    setDraft(value)
    setDirty(value !== skill.content)
  }

  return { dirty, draft, handleChange }
}

const SkillEditor = (
  {
    onDelete,
    onSave,
    skill
  }: {
    readonly onDelete: () => void
    readonly onSave: (content: string) => void
    readonly skill: ProjectSkillFile
  }
): JSX.Element => {
  const { dirty, draft, handleChange } = useSkillDraft(skill)
  const handleSave = () => {
    onSave(draft)
  }

  return (
    <Box border={true} borderColor="#3a4652" flexDirection="column" gap={1} padding={1}>
      <SkillEditorHeader skill={skill} />
      <TextInput
        ariaLabel={`SKILL.md editor for ${skill.scope}/${skill.name}`}
        minRows={8}
        multiline={true}
        onChange={handleChange}
        onEnter={handleSave}
        placeholder="# Skill\n\nDescribe what this skill does…"
        value={draft}
      />
      <SkillEditorActions dirty={dirty} onDelete={onDelete} onSave={handleSave} />
    </Box>
  )
}

const NewSkillScopePicker = (
  {
    onSelect,
    scope,
    scopes
  }: {
    readonly onSelect: (scope: ProjectSkillScope) => void
    readonly scope: ProjectSkillScope
    readonly scopes: ReadonlyArray<ProjectSkillScopeInfo>
  }
): JSX.Element => (
  <Box flexWrap="wrap" gap={1}>
    {scopes.map((info) => (
      <Box
        key={info.scope}
        onClick={() => {
          onSelect(info.scope)
        }}
        width="auto"
      >
        <Text bold={info.scope === scope} fg={info.scope === scope ? "#78f0a3" : "#7fdfff"}>
          {info.scope}
        </Text>
      </Box>
    ))}
  </Box>
)

const NewSkillForm = (
  {
    onSave,
    scopes
  }: {
    readonly onSave: (scope: ProjectSkillScope, name: string, content: string) => void
    readonly scopes: ReadonlyArray<ProjectSkillScopeInfo>
  }
): JSX.Element => {
  const [scope, setScope] = useState<ProjectSkillScope>(() => scopes[0]?.scope ?? "skills")
  const [name, setName] = useState("")
  const [content, setContent] = useState("")

  const handleCreate = () => {
    if (name.trim().length === 0) {
      return
    }
    onSave(scope, name.trim(), content)
    setName("")
    setContent("")
  }

  return (
    <Box border={true} borderColor="#24537d" flexDirection="column" gap={1} padding={1}>
      <Text bold={true} fg="#8be9fd">New skill</Text>
      <Text fg="#d6e5f7">Scope</Text>
      <NewSkillScopePicker onSelect={setScope} scope={scope} scopes={scopes} />
      <Text fg="#d6e5f7">Skill name</Text>
      <TextInput ariaLabel="New skill name" onChange={setName} placeholder="my-skill" value={name} />
      <Text fg="#d6e5f7">SKILL.md content</Text>
      <TextInput
        ariaLabel="New skill content"
        minRows={6}
        multiline={true}
        onChange={setContent}
        onEnter={handleCreate}
        placeholder="# My Skill\n\nWrite SKILL.md content here…"
        value={content}
      />
      <Box flexWrap="wrap" gap={1}>
        <Box onClick={handleCreate} width="auto">
          <Text bold={true} fg="#78f0a3">Create skill</Text>
        </Box>
      </Box>
    </Box>
  )
}

const SkillsScopeSection = (
  {
    info,
    onDeleteSkill,
    onSaveSkill,
    skills
  }: {
    readonly info: ProjectSkillScopeInfo
    readonly onDeleteSkill: (scope: ProjectSkillScope, name: string) => void
    readonly onSaveSkill: (scope: ProjectSkillScope, name: string, content: string) => void
    readonly skills: ReadonlyArray<ProjectSkillFile>
  }
): JSX.Element => (
  <Box flexDirection="column" gap={1}>
    <Text bold={true} fg="#d6e5f7">{info.scope}</Text>
    <Text fg="#8fa6c4" wrap="truncate">{info.relativeRoot}</Text>
    {skills.length === 0
      ? <Text fg="#8fa6c4">No skills in this scope yet.</Text>
      : skills.map((skill) => (
        <SkillEditor
          key={skill.id}
          onDelete={() => {
            onDeleteSkill(skill.scope, skill.name)
          }}
          onSave={(content) => {
            onSaveSkill(skill.scope, skill.name, content)
          }}
          skill={skill}
        />
      ))}
  </Box>
)

const useSkillsByScope = (snapshot: ProjectSkillsSnapshot | null) =>
  useMemo(() => {
    if (snapshot === null) {
      return new Map<ProjectSkillScope, ReadonlyArray<ProjectSkillFile>>()
    }
    const groups = new Map<ProjectSkillScope, Array<ProjectSkillFile>>()
    for (const skill of snapshot.skills) {
      const list = groups.get(skill.scope) ?? []
      list.push(skill)
      groups.set(skill.scope, list)
    }
    return groups
  }, [snapshot])

const SkillsPanelHeader = (
  {
    onRefreshSkills,
    selectedProjectSummary,
    snapshot
  }: Pick<SkillsPanelProps, "onRefreshSkills" | "selectedProjectSummary" | "snapshot">
): JSX.Element => (
  <>
    <Text bold={true} fg="#8be9fd">Project skills</Text>
    <Text fg="#d6e5f7" wrap="wrap">
      Manage SKILL.md files across the conventional skill folders shared with Claude, Codex, Gemini and generic agents.
      Each entry edits a single SKILL.md file under the project directory.
    </Text>
    <Text fg="#8fa6c4" wrap="truncate">
      Project: {selectedProjectSummary?.displayName ?? "not selected"}
    </Text>
    <Text fg="#8fa6c4" wrap="truncate">
      {snapshot === null ? "Loading skills…" : `Directory: ${snapshot.projectDir}`}
    </Text>
    <Box flexWrap="wrap" gap={1}>
      <Box onClick={onRefreshSkills} width="auto">
        <Text bold={true} fg="#7fdfff">refresh</Text>
      </Box>
    </Box>
  </>
)

export const ProjectSkillsPanel = (
  { onDeleteSkill, onRefreshSkills, onSaveSkill, selectedProjectSummary, snapshot }: SkillsPanelProps
): JSX.Element => {
  const skillsByScope = useSkillsByScope(snapshot)

  return (
    <Box flexDirection="column" gap={1}>
      <SkillsPanelHeader
        onRefreshSkills={onRefreshSkills}
        selectedProjectSummary={selectedProjectSummary}
        snapshot={snapshot}
      />
      {snapshot === null
        ? <Text fg="#8fa6c4">No skill data yet.</Text>
        : (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <NewSkillForm onSave={onSaveSkill} scopes={snapshot.scopes} />
            {snapshot.scopes.map((info) => (
              <SkillsScopeSection
                key={info.scope}
                info={info}
                onDeleteSkill={onDeleteSkill}
                onSaveSkill={onSaveSkill}
                skills={skillsByScope.get(info.scope) ?? []}
              />
            ))}
          </Box>
        )}
    </Box>
  )
}
