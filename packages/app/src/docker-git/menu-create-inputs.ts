import { defaultTemplateConfig, deriveRepoPathParts, resolveRepoInput } from "./frontend-lib/core/domain.js"
import { defaultProjectsRoot } from "./frontend-lib/usecases/menu-helpers.js"
import type { CreateFlowContext } from "./menu-create-flow-types.js"
import type { CreateInputs } from "./menu-types.js"

/**
 * Removes leading path separators from a path segment.
 *
 * @param value - Path segment to normalize.
 * @returns The segment without leading slash characters.
 *
 * @pure true
 * @effect n/a
 * @invariant Result length is less than or equal to input length.
 * @precondition `value` is a finite string.
 * @postcondition The result does not start with `/` unless it is empty.
 * @complexity O(n) time and O(n) space where n = |value|.
 * @throws Never
 */
const trimLeftSlash = (value: string): string => {
  let start = 0
  while (start < value.length && value[start] === "/") {
    start += 1
  }
  return value.slice(start)
}

/**
 * Removes trailing path separators from a path segment.
 *
 * @param value - Path segment to normalize.
 * @returns The segment without trailing slash characters.
 *
 * @pure true
 * @effect n/a
 * @invariant Result length is less than or equal to input length.
 * @precondition `value` is a finite string.
 * @postcondition The result does not end with `/` unless it is empty.
 * @complexity O(n) time and O(n) space where n = |value|.
 * @throws Never
 */
const trimRightSlash = (value: string): string => {
  let end = value.length
  while (end > 0 && value[end - 1] === "/") {
    end -= 1
  }
  return value.slice(0, end)
}

/**
 * Joins normalized POSIX-style path parts while preserving a root `/`.
 *
 * @param parts - Ordered path parts, starting with the base directory.
 * @returns A slash-separated path with empty non-root segments removed.
 *
 * @pure true
 * @effect n/a
 * @invariant A leading `/` base remains absolute in the result.
 * @precondition Each part is a finite string.
 * @postcondition Non-root parts do not introduce duplicate separators.
 * @complexity O(p + n) time and O(p + n) space where p = |parts| and n = total input length.
 * @throws Never
 */
const joinPath = (...parts: ReadonlyArray<string>): string => {
  const cleaned = parts
    .filter((part) => part.length > 0)
    .map((part, index) => {
      if (index === 0) {
        const trimmed = trimRightSlash(part)
        return trimmed.length === 0 && part.startsWith("/") ? "/" : trimmed
      }
      return trimRightSlash(trimLeftSlash(part))
    })
    .filter((part, index) => index === 0 || part.length > 0)

  if (cleaned.length === 0) {
    return ""
  }
  if (cleaned[0] === "/") {
    return cleaned.length === 1 ? "/" : `/${cleaned.slice(1).join("/")}`
  }
  return cleaned.join("/")
}

/**
 * Normalizes legacy cwd input into the create-flow context record.
 *
 * @param context - Legacy cwd string or already-normalized context record.
 * @returns A context record with at least `cwd` defined.
 *
 * @pure true
 * @effect n/a
 * @invariant string input maps to { cwd: input }
 * @precondition `context` is a finite cwd string or CreateFlowContext.
 * @postcondition Object context input is preserved by reference.
 * @complexity O(1) time and O(1) space.
 * @throws Never
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

/**
 * Resolves the configured projects root or derives it from cwd.
 *
 * @param context - Create-flow context with cwd and optional projectsRoot.
 * @returns Explicit non-blank projectsRoot, otherwise the cwd-derived default.
 *
 * @pure true
 * @effect n/a
 * @invariant Non-blank `projectsRoot` takes precedence over cwd defaults.
 * @precondition `context.cwd` is a finite string.
 * @postcondition Returned root is a finite string.
 * @complexity O(n) time and O(n) space where n = |context.projectsRoot ?? context.cwd|.
 * @throws Never
 */
const resolveProjectsRoot = (context: CreateFlowContext): string =>
  context.projectsRoot?.trim().length
    ? context.projectsRoot
    : defaultProjectsRoot(context.cwd)

/**
 * Resolves the default output directory for a repo input.
 *
 * @param context - Create-flow context used to select the projects root.
 * @param repoUrl - Repository input accepted by `resolveRepoInput`.
 * @returns Default output directory under the resolved projects root.
 *
 * @pure true
 * @effect n/a
 * @invariant output is rooted under the resolved projects root
 * @precondition `repoUrl` is a finite string.
 * @postcondition The result contains the repository path parts in order.
 * @complexity O(n) time and O(n) space where n = |repoUrl|.
 * @throws Never
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
 * @param contextOrCwd - Legacy cwd string or create-flow context.
 * @param values - Partial create inputs collected by the flow.
 * @returns Total create inputs with deterministic defaults.
 *
 * @pure true
 * @effect n/a
 * @invariant every CreateInputs field is defined in the result
 * @precondition `values` is a finite partial record.
 * @postcondition Explicit false boolean fields remain false in the result.
 * @complexity O(n) time and O(n) space where n = |repoUrl|.
 * @throws Never
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
