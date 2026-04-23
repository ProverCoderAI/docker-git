import { filterSelectItemsByQuery } from "../docker-git/menu-select-filter.js"
import type { DashboardData, ProjectSummary } from "./api.js"

// CHANGE: use Select search semantics for WEB project search
// WHY: container-name search must be identical in CLI Select and WEB ProjectPicker
// QUOTE(ТЗ): "Можешь добавить ещё поиск контейнеров по имени?"
// REF: user-message-2026-04-22-container-name-search
// SOURCE: n/a
// FORMAT THEOREM: forall q,p: web_match(q,p) = select_match(q,p)
// PURITY: CORE
// EFFECT: none
// INVARIANT: empty query preserves dashboard project order and cardinality
// COMPLEXITY: O(n*m*f) where n = |projects|, m = |terms|, f = searchable fields
export const filterProjectSummariesByQuery = (
  projects: ReadonlyArray<ProjectSummary>,
  query: string
): ReadonlyArray<ProjectSummary> =>
  filterSelectItemsByQuery(projects, query, {
    clonedOnHostname: (project) => project.clonedOnHostname,
    containerName: (project) => project.containerName,
    displayName: (project) => project.displayName,
    projectKey: (project) => project.id,
    repoRef: (project) => project.repoRef,
    repoUrl: (project) => project.repoUrl
  })

export const filterDashboardProjectsByQuery = (
  dashboard: DashboardData,
  query: string
): DashboardData => ({
  ...dashboard,
  projects: filterProjectSummariesByQuery(dashboard.projects, query)
})
