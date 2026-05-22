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

/**
 * Normalizes legacy cwd input into the create-flow context record.
 *
 * @pure true
 * @invariant string input maps to { cwd: input }
 * @complexity O(1)
 */
// CHANGE: normalize create-flow context boundaries into one record shape
// WHY: pure helpers can share cwd and optional projectsRoot resolution
// QUOTE(ТЗ): "Add concise but compliant TSDoc + functional comments"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: forall c: normalize(c).cwd is defined
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: object context is preserved by reference
// COMPLEXITY: O(1)
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

/**
 * Resolves the default output directory for a repo input.
 *
 * @pure true
 * @invariant output is rooted under the resolved projects root
 * @complexity O(n) where n = |repoUrl|
 */
// CHANGE: derive create-flow output directory from repo identity and context root
// WHY: repo URL, branch suffix, and browser-provided projectsRoot must resolve consistently
// QUOTE(ТЗ): "Add concise but compliant TSDoc + functional comments"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: forall r: outDir(r) = projectsRoot / repoPathParts(r)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: no duplicate path separator is introduced by joinPath
// COMPLEXITY: O(n) where n = |repoUrl|
export const resolveDefaultOutDir = (context: CreateFlowContext, repoUrl: string): string => {
  const resolvedRepo = resolveRepoInput(repoUrl)
  const baseParts = deriveRepoPathParts(resolvedRepo.repoUrl).pathParts
  const projectParts = resolvedRepo.workspaceSuffix ? [...baseParts, resolvedRepo.workspaceSuffix] : baseParts
  return joinPath(resolveProjectsRoot(context), ...projectParts)
}

/**
 * Resolves partial create-flow values into total create command inputs.
 *
 * @pure true
 * @invariant every CreateInputs field is defined in the result
 * @complexity O(n) where n = |repoUrl|
 */
// CHANGE: totalize create-flow partial values with deterministic defaults
// WHY: completion must hand the shell a complete create command input record
// QUOTE(ТЗ): "Add concise but compliant TSDoc + functional comments"
// REF: issue-339
// SOURCE: n/a
// FORMAT THEOREM: forall p: resolve(p) in CreateInputs
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: explicit false boolean values are preserved
// COMPLEXITY: O(n) where n = |repoUrl|
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
