import { deriveRepoPathParts, resolveRepoInput } from "@effect-template/lib/core/domain"
import { defaultProjectsRoot } from "@effect-template/lib/usecases/menu-helpers"

import type { CreateInputs } from "./menu-types.js"

export const buildCreateArgs = (input: CreateInputs): ReadonlyArray<string> => {
  const args: Array<string> = [
    "create",
    "--repo-url",
    input.repoUrl,
    "--secrets-root",
    input.secretsRoot,
    "--base-flavor",
    input.baseFlavor
  ]
  if (input.repoRef.length > 0) {
    args.push("--repo-ref", input.repoRef)
  }
  args.push("--out-dir", input.outDir)
  if (!input.runUp) {
    args.push("--no-up")
  }
  if (input.enableMcpPlaywright) {
    args.push("--mcp-playwright")
  }
  if (input.force) {
    args.push("--force")
  }
  if (input.forceEnv) {
    args.push("--force-env")
  }
  return args
}

const trimLeftSlash = (value: string): string => {
  let start = 0
  while (start < value.length && value[start] === "/") {
    start += 1
  }
  return value.slice(start)
}

const trimRightSlash = (value: string): string => {
  let end = value.length
  while (end > 0 && value[end - 1] === "/") {
    end -= 1
  }
  return value.slice(0, end)
}

const joinPath = (...parts: ReadonlyArray<string>): string => {
  const cleaned = parts
    .filter((part) => part.length > 0)
    .map((part, index) => {
      if (index === 0) {
        return trimRightSlash(part)
      }
      return trimRightSlash(trimLeftSlash(part))
    })
  return cleaned.join("/")
}

export const resolveDefaultOutDir = (cwd: string, repoUrl: string): string => {
  const resolvedRepo = resolveRepoInput(repoUrl)
  const baseParts = deriveRepoPathParts(resolvedRepo.repoUrl).pathParts
  const projectParts = resolvedRepo.workspaceSuffix ? [...baseParts, resolvedRepo.workspaceSuffix] : baseParts
  return joinPath(defaultProjectsRoot(cwd), ...projectParts)
}

const resolveRepoRef = (
  repoUrl: string,
  values: Partial<CreateInputs>
): string => {
  if (values.repoRef !== undefined) {
    return values.repoRef
  }
  if (repoUrl.length === 0) {
    return "main"
  }
  return resolveRepoInput(repoUrl).repoRef ?? "main"
}

const resolveSecretsRoot = (
  cwd: string,
  values: Partial<CreateInputs>
): string => values.secretsRoot ?? joinPath(defaultProjectsRoot(cwd), "secrets")

const resolveOutDir = (
  cwd: string,
  repoUrl: string,
  values: Partial<CreateInputs>
): string => {
  if (values.outDir !== undefined) {
    return values.outDir
  }
  if (repoUrl.length === 0) {
    return ""
  }
  return resolveDefaultOutDir(cwd, repoUrl)
}

export const resolveCreateInputs = (
  cwd: string,
  values: Partial<CreateInputs>
): CreateInputs => {
  const repoUrl = values.repoUrl ?? ""
  const repoRef = resolveRepoRef(repoUrl, values)
  const secretsRoot = resolveSecretsRoot(cwd, values)
  const outDir = resolveOutDir(cwd, repoUrl, values)

  return {
    repoUrl,
    repoRef,
    outDir,
    secretsRoot,
    baseFlavor: values.baseFlavor ?? "ubuntu",
    runUp: values.runUp !== false,
    enableMcpPlaywright: values.enableMcpPlaywright === true,
    force: values.force === true,
    forceEnv: values.forceEnv === true
  }
}

export const parseYesDefault = (input: string, fallback: boolean): boolean => {
  const normalized = input.trim().toLowerCase()
  if (normalized === "y" || normalized === "yes") {
    return true
  }
  if (normalized === "n" || normalized === "no") {
    return false
  }
  return fallback
}

export const parseBaseFlavorDefault = (
  input: string,
  fallback: CreateInputs["baseFlavor"]
): CreateInputs["baseFlavor"] => {
  const normalized = input.trim().toLowerCase()
  if (normalized === "nix") {
    return "nix"
  }
  if (normalized === "ubuntu") {
    return "ubuntu"
  }
  return fallback
}
