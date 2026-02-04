import path from "node:path"

const envKey = "DOCKER_GIT_PROJECTS_ROOT"

// CHANGE: derive docker-git projects root for Next.js API routes
// WHY: Next.js runs from packages/web, but docker-git projects live at repo root
// QUOTE(ТЗ): "У нас вся инфа лежит в папке .docker-git"
// REF: user-request-2026-02-03-web-ui-root
// SOURCE: n/a
// FORMAT THEOREM: forall cwd: root(cwd) = repo/.docker-git
// PURITY: SHELL
// EFFECT: Effect<string, never, never>
// INVARIANT: returns an absolute path
// COMPLEXITY: O(1)
export const ensureProjectsRoot = (): string => {
  const existing = process.env[envKey]?.trim()
  if (existing && existing.length > 0) {
    return existing
  }

  const root = path.resolve(process.cwd(), "..", "..", ".docker-git")
  process.env[envKey] = root
  return root
}
