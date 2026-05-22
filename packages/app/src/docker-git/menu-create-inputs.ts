import { defaultTemplateConfig, deriveRepoPathParts, resolveRepoInput } from "./frontend-lib/core/domain.js"
import { defaultProjectsRoot } from "./frontend-lib/usecases/menu-helpers.js"
import type { CreateFlowContext } from "./menu-create-flow-types.js"
import type { CreateInputs } from "./menu-types.js"

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

export const normalizeCreateFlowContext = (
  context: string | CreateFlowContext
): CreateFlowContext =>
  typeof context === "string"
    ? { cwd: context }
    : context

const resolveProjectsRoot = (context: CreateFlowContext): string =>
  context.projectsRoot?.trim().length
    ? context.projectsRoot
    : defaultProjectsRoot(context.cwd)

export const resolveDefaultOutDir = (context: CreateFlowContext, repoUrl: string): string => {
  const resolvedRepo = resolveRepoInput(repoUrl)
  const baseParts = deriveRepoPathParts(resolvedRepo.repoUrl).pathParts
  const projectParts = resolvedRepo.workspaceSuffix ? [...baseParts, resolvedRepo.workspaceSuffix] : baseParts
  return joinPath(resolveProjectsRoot(context), ...projectParts)
}

export const resolveCreateInputs = (
  contextOrCwd: string | CreateFlowContext,
  values: Partial<CreateInputs>
): CreateInputs => {
  const context = normalizeCreateFlowContext(contextOrCwd)
  const repoUrl = values.repoUrl ?? ""
  const resolvedRepoRef = resolveRepoInput(repoUrl).repoRef
  const outDir = values.outDir ?? resolveDefaultOutDir(context, repoUrl)

  return {
    repoUrl,
    repoRef: values.repoRef ?? resolvedRepoRef ?? "main",
    outDir,
    cpuLimit: values.cpuLimit ?? "",
    ramLimit: values.ramLimit ?? "",
    gpu: values.gpu ?? defaultTemplateConfig.gpu,
    runUp: values.runUp !== false,
    enableMcpPlaywright: values.enableMcpPlaywright === true,
    force: values.force === true,
    forceEnv: values.forceEnv === true
  }
}
