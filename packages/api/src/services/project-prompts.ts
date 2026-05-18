import * as FileSystem from "@effect/platform/FileSystem"
import type { PlatformError } from "@effect/platform/Error"
import * as Path from "@effect/platform/Path"
import { Effect, pipe } from "effect"

import type { ProjectDetails } from "../api/contracts.js"
import { ApiBadRequestError } from "../api/errors.js"

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

const promptDescriptors: ReadonlyArray<{ kind: ProjectPromptKind; fileName: string }> = [
  { kind: "claude", fileName: "CLAUDE.md" },
  { kind: "codex", fileName: "AGENTS.md" },
  { kind: "gemini", fileName: "GEMINI.md" },
  { kind: "grok", fileName: "GROK.md" }
]

const maxPromptBytes = 1024 * 256

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

const readPromptFile = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  projectDir: string,
  kind: ProjectPromptKind,
  fileName: string
): Effect.Effect<ProjectPromptFile, PlatformError> =>
  Effect.gen(function*(_) {
    const absolutePath = path.join(projectDir, fileName)
    const present = yield* _(hasFileAtPath(fs, absolutePath))
    if (!present) {
      return {
        kind,
        fileName,
        relativePath: fileName,
        absolutePath,
        exists: false,
        bytes: 0,
        content: ""
      }
    }
    const content = yield* _(fs.readFileString(absolutePath))
    return {
      kind,
      fileName,
      relativePath: fileName,
      absolutePath,
      exists: true,
      bytes: Buffer.byteLength(content, "utf8"),
      content
    }
  })

export const readProjectPromptsSnapshot = (
  project: ProjectDetails
): Effect.Effect<ProjectPromptsSnapshot, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const prompts: Array<ProjectPromptFile> = []
    for (const descriptor of promptDescriptors) {
      const file = yield* _(readPromptFile(fs, path, project.projectDir, descriptor.kind, descriptor.fileName))
      prompts.push(file)
    }
    return {
      projectId: project.id,
      projectKey: project.projectKey,
      projectDir: project.projectDir,
      prompts
    }
  })

const findDescriptor = (kind: ProjectPromptKind): { kind: ProjectPromptKind; fileName: string } => {
  const found = promptDescriptors.find((descriptor) => descriptor.kind === kind)
  if (found === undefined) {
    throw new Error(`Unknown prompt kind: ${kind}`)
  }
  return found
}

export const writeProjectPrompt = (
  project: ProjectDetails,
  kind: ProjectPromptKind,
  content: string
): Effect.Effect<ProjectPromptFile, ApiBadRequestError | PlatformError, FileSystem.FileSystem | Path.Path> => {
  if (Buffer.byteLength(content, "utf8") > maxPromptBytes) {
    return Effect.fail(
      new ApiBadRequestError({ message: `Prompt is too large: maximum ${maxPromptBytes} bytes.` })
    )
  }
  const descriptor = findDescriptor(kind)
  return pipe(
    Effect.all({
      fs: FileSystem.FileSystem,
      path: Path.Path
    }),
    Effect.flatMap(({ fs, path }) =>
      Effect.gen(function*(_) {
        const projectDirExists = yield* _(fs.exists(project.projectDir))
        if (!projectDirExists) {
          return yield* _(
            Effect.fail(
              new ApiBadRequestError({ message: `Project directory does not exist: ${project.projectDir}` })
            )
          )
        }
        const absolutePath = path.join(project.projectDir, descriptor.fileName)
        yield* _(fs.writeFileString(absolutePath, content))
        return yield* _(readPromptFile(fs, path, project.projectDir, descriptor.kind, descriptor.fileName))
      })
    )
  )
}

export const deleteProjectPrompt = (
  project: ProjectDetails,
  kind: ProjectPromptKind
): Effect.Effect<ProjectPromptFile, ApiBadRequestError | PlatformError, FileSystem.FileSystem | Path.Path> => {
  const descriptor = findDescriptor(kind)
  return Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const absolutePath = path.join(project.projectDir, descriptor.fileName)
    const present = yield* _(hasFileAtPath(fs, absolutePath))
    if (present) {
      yield* _(fs.remove(absolutePath))
    }
    return yield* _(readPromptFile(fs, path, project.projectDir, descriptor.kind, descriptor.fileName))
  })
}
