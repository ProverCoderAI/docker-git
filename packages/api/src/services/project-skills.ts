import * as FileSystem from "@effect/platform/FileSystem"
import type { PlatformError } from "@effect/platform/Error"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import type { ProjectDetails } from "../api/contracts.js"
import { ApiBadRequestError, ApiNotFoundError } from "../api/errors.js"

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

export type ProjectSkillsSnapshot = {
  readonly projectId: string
  readonly projectKey: string
  readonly projectDir: string
  readonly skills: ReadonlyArray<ProjectSkillFile>
  readonly scopes: ReadonlyArray<{ readonly scope: ProjectSkillScope; readonly relativeRoot: string; readonly absoluteRoot: string }>
}

const skillScopes: ReadonlyArray<{ scope: ProjectSkillScope; relativeRoot: string }> = [
  { scope: "skills", relativeRoot: ".skills" },
  { scope: "agents/skills", relativeRoot: ".agents/skills" },
  { scope: "agents/.skills", relativeRoot: ".agents/.skills" },
  { scope: "claude/skills", relativeRoot: ".claude/skills" },
  { scope: "codex/skills", relativeRoot: ".codex/skills" },
  { scope: "gemini/skills", relativeRoot: ".gemini/skills" },
  { scope: "grok/skills", relativeRoot: ".grok/skills" }
]

const skillFileName = "SKILL.md"
const maxSkillBytes = 1024 * 256
const maxSkillNameLength = 96

const safeSkillNameRegex = /^[a-zA-Z0-9._-]+$/u

const isSafeSkillName = (name: string): boolean =>
  name.length > 0 &&
  name.length <= maxSkillNameLength &&
  safeSkillNameRegex.test(name) &&
  name !== "." &&
  name !== ".." &&
  !name.startsWith(".")

const ensureWithinProject = (
  path: Path.Path,
  projectDir: string,
  candidate: string
): boolean => {
  const normalizedProject = path.resolve(projectDir)
  const normalizedCandidate = path.resolve(candidate)
  if (normalizedCandidate === normalizedProject) {
    return false
  }
  const prefix = normalizedProject.endsWith(path.sep) ? normalizedProject : `${normalizedProject}${path.sep}`
  return normalizedCandidate.startsWith(prefix)
}

const findScopeByValue = (scope: ProjectSkillScope): { scope: ProjectSkillScope; relativeRoot: string } => {
  const found = skillScopes.find((entry) => entry.scope === scope)
  if (found === undefined) {
    throw new Error(`Unknown skill scope: ${scope}`)
  }
  return found
}

const hasFileAtPath = (
  fs: FileSystem.FileSystem,
  filePath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const exists = yield* _(fs.exists(filePath))
    if (!exists) {
      return false
    }
    const info = yield* _(fs.stat(filePath))
    return info.type === "File"
  })

const readSkillFile = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  projectDir: string,
  scope: ProjectSkillScope,
  relativeRoot: string,
  name: string
): Effect.Effect<ProjectSkillFile | null, PlatformError> =>
  Effect.gen(function*(_) {
    const absoluteSkillDir = path.join(projectDir, relativeRoot, name)
    const absolutePath = path.join(absoluteSkillDir, skillFileName)
    const present = yield* _(hasFileAtPath(fs, absolutePath))
    if (!present) {
      return null
    }
    const stat = yield* _(fs.stat(absolutePath))
    const content = yield* _(fs.readFileString(absolutePath))
    const updatedAtIso =
      stat.mtime._tag === "Some" ? stat.mtime.value.toISOString() : null
    return {
      id: `${scope}:${name}`,
      scope,
      name,
      relativePath: path.join(relativeRoot, name, skillFileName),
      absolutePath,
      bytes: Buffer.byteLength(content, "utf8"),
      content,
      updatedAtIso
    }
  })

const listSkillsForScope = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  projectDir: string,
  scope: ProjectSkillScope,
  relativeRoot: string
): Effect.Effect<ReadonlyArray<ProjectSkillFile>, PlatformError> =>
  Effect.gen(function*(_) {
    const absoluteRoot = path.join(projectDir, relativeRoot)
    const exists = yield* _(fs.exists(absoluteRoot))
    if (!exists) {
      return []
    }
    const info = yield* _(fs.stat(absoluteRoot))
    if (info.type !== "Directory") {
      return []
    }
    const entries = yield* _(fs.readDirectory(absoluteRoot))
    const skills: Array<ProjectSkillFile> = []
    for (const entry of entries) {
      if (!isSafeSkillName(entry)) {
        continue
      }
      const subPath = path.join(absoluteRoot, entry)
      const subInfo = yield* _(fs.stat(subPath))
      if (subInfo.type !== "Directory") {
        continue
      }
      const skill = yield* _(readSkillFile(fs, path, projectDir, scope, relativeRoot, entry))
      if (skill !== null) {
        skills.push(skill)
      }
    }
    return skills
  })

export const readProjectSkillsSnapshot = (
  project: ProjectDetails
): Effect.Effect<ProjectSkillsSnapshot, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const skills: Array<ProjectSkillFile> = []
    const scopes: Array<{ scope: ProjectSkillScope; relativeRoot: string; absoluteRoot: string }> = []
    for (const entry of skillScopes) {
      const absoluteRoot = path.join(project.projectDir, entry.relativeRoot)
      scopes.push({ scope: entry.scope, relativeRoot: entry.relativeRoot, absoluteRoot })
      const found = yield* _(listSkillsForScope(fs, path, project.projectDir, entry.scope, entry.relativeRoot))
      for (const skill of found) {
        skills.push(skill)
      }
    }
    return {
      projectId: project.id,
      projectKey: project.projectKey,
      projectDir: project.projectDir,
      skills,
      scopes
    }
  })

export const writeProjectSkill = (
  project: ProjectDetails,
  scope: ProjectSkillScope,
  name: string,
  content: string
): Effect.Effect<ProjectSkillFile, ApiBadRequestError | PlatformError, FileSystem.FileSystem | Path.Path> => {
  if (!isSafeSkillName(name)) {
    return Effect.fail(
      new ApiBadRequestError({
        message:
          "Invalid skill name: only [A-Za-z0-9._-] (no leading dot, max 96 chars) characters are allowed."
      })
    )
  }
  if (Buffer.byteLength(content, "utf8") > maxSkillBytes) {
    return Effect.fail(
      new ApiBadRequestError({ message: `Skill is too large: maximum ${maxSkillBytes} bytes.` })
    )
  }
  const descriptor = findScopeByValue(scope)
  return Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const projectDirExists = yield* _(fs.exists(project.projectDir))
    if (!projectDirExists) {
      return yield* _(
        Effect.fail(
          new ApiBadRequestError({ message: `Project directory does not exist: ${project.projectDir}` })
        )
      )
    }
    const absoluteSkillDir = path.join(project.projectDir, descriptor.relativeRoot, name)
    if (!ensureWithinProject(path, project.projectDir, absoluteSkillDir)) {
      return yield* _(
        Effect.fail(new ApiBadRequestError({ message: "Skill path escapes project directory." }))
      )
    }
    yield* _(fs.makeDirectory(absoluteSkillDir, { recursive: true }))
    const absolutePath = path.join(absoluteSkillDir, skillFileName)
    yield* _(fs.writeFileString(absolutePath, content))
    const skill = yield* _(readSkillFile(fs, path, project.projectDir, descriptor.scope, descriptor.relativeRoot, name))
    if (skill === null) {
      return yield* _(
        Effect.fail(new ApiBadRequestError({ message: "Failed to read skill after writing." }))
      )
    }
    return skill
  })
}

export const deleteProjectSkill = (
  project: ProjectDetails,
  scope: ProjectSkillScope,
  name: string
): Effect.Effect<void, ApiBadRequestError | ApiNotFoundError | PlatformError, FileSystem.FileSystem | Path.Path> => {
  if (!isSafeSkillName(name)) {
    return Effect.fail(
      new ApiBadRequestError({
        message: "Invalid skill name."
      })
    )
  }
  const descriptor = findScopeByValue(scope)
  return Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const absoluteSkillDir = path.join(project.projectDir, descriptor.relativeRoot, name)
    if (!ensureWithinProject(path, project.projectDir, absoluteSkillDir)) {
      return yield* _(
        Effect.fail(new ApiBadRequestError({ message: "Skill path escapes project directory." }))
      )
    }
    const present = yield* _(fs.exists(absoluteSkillDir))
    if (!present) {
      return yield* _(
        Effect.fail(new ApiNotFoundError({ message: `Skill not found: ${descriptor.relativeRoot}/${name}` }))
      )
    }
    yield* _(fs.remove(absoluteSkillDir, { recursive: true }))
  })
}
