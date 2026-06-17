import { NodeContext } from "@effect/platform-node"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import ts from "typescript"

const sourceRootPath = new URL("../../src", import.meta.url).pathname

type ArchitectureTestServices = FileSystem.FileSystem | Path.Path

const flattenReadonly = <A>(
  arrays: ReadonlyArray<ReadonlyArray<A>>
): ReadonlyArray<A> => arrays.flat()

const sourceFilesForEntry = (
  directory: string,
  entry: string
): Effect.Effect<ReadonlyArray<string>, PlatformError, ArchitectureTestServices> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const entryPath = path.join(directory, entry)
    const info = yield* _(fs.stat(entryPath))
    if (info.type === "Directory") {
      return yield* _(sourceFiles(entryPath))
    }
    return info.type === "File" && entryPath.endsWith(".ts") ? [entryPath] : []
  })

const sourceFiles = (
  directory: string
): Effect.Effect<ReadonlyArray<string>, PlatformError, ArchitectureTestServices> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const entries = yield* _(fs.readDirectory(directory))
    const files = yield* _(
      Effect.all(entries.map((entry) => sourceFilesForEntry(directory, entry)))
    )
    return flattenReadonly(files)
  })

const stringLiteralText = (node: ts.Node | undefined): string | null =>
  node !== undefined && ts.isStringLiteralLike(node) ? node.text : null

const importTypeSource = (node: ts.ImportTypeNode): string | null => {
  const argument = node.argument
  if (!ts.isLiteralTypeNode(argument)) {
    return null
  }
  return stringLiteralText(argument.literal)
}

const importSourceForNode = (node: ts.Node): string | null => {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return stringLiteralText(node.moduleSpecifier)
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return stringLiteralText(node.arguments.at(0))
  }
  if (ts.isImportTypeNode(node)) {
    return importTypeSource(node)
  }
  return null
}

const importsFromSourceFile = (sourceFile: ts.SourceFile): ReadonlyArray<string> => {
  const visit = (node: ts.Node): ReadonlyArray<string> => {
    const ownSource = importSourceForNode(node)
    const childSources = node.getChildren(sourceFile).flatMap((child) => visit(child))
    return ownSource === null ? childSources : [ownSource, ...childSources]
  }
  return visit(sourceFile)
}

const importsFrom = (
  sourcePath: string
): Effect.Effect<ReadonlyArray<string>, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const sourceText = yield* _(fs.readFileString(sourcePath))
    const sourceFile = ts.createSourceFile(
      sourcePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    )
    return importsFromSourceFile(sourceFile)
  })

const isBannedCoreImport = (source: string): boolean =>
  source.includes("/shell") ||
  source.includes("/server") ||
  source.includes("/web") ||
  source.includes("/cli") ||
  source === "ws" ||
  source === "xterm" ||
  source.startsWith("node:")

const boundaryViolationsForFile = (
  path: Path.Path,
  file: string
): Effect.Effect<ReadonlyArray<string>, PlatformError, FileSystem.FileSystem> =>
  Effect.map(importsFrom(file), (sources) =>
    sources
      .filter((source) => isBannedCoreImport(source))
      .map((source) => `${path.relative(sourceRootPath, file)} -> ${source}`))

describe("terminal package boundaries", () => {
  it.effect("keeps contracts and core free of runtime adapter imports", () =>
    Effect.gen(function*(_) {
      const path = yield* _(Path.Path)
      const contractsFiles = sourceFiles(`${sourceRootPath}/contracts`)
      const coreFiles = sourceFiles(`${sourceRootPath}/core`)
      const groupedFiles = Effect.all([contractsFiles, coreFiles])
      const files = yield* _(
        Effect.map(
          groupedFiles,
          ([contractFileList, coreFileList]) => [...contractFileList, ...coreFileList]
        )
      )
      const fileViolationEffects = files.map((file) => boundaryViolationsForFile(path, file))
      const allViolations = Effect.all(fileViolationEffects)
      const violations = yield* _(
        Effect.map(
          allViolations,
          (fileViolations) => flattenReadonly(fileViolations)
        )
      )

      expect(violations).toEqual([])
    }).pipe(Effect.provide(NodeContext.layer)))
})
