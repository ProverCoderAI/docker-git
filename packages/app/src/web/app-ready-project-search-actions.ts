import type { DashboardData } from "./api.js"
import type { ReadyState } from "./app-ready-hooks.js"
import { filterProjectSummariesByQuery } from "./project-search.js"

const resolveSearchSelectedProjectId = (
  projects: DashboardData["projects"],
  selectedProjectId: string | null
): string | null => {
  if (selectedProjectId !== null && projects.some((project) => project.id === selectedProjectId)) {
    return selectedProjectId
  }
  return projects[0]?.id ?? null
}

export const bindProjectSearchActions = (
  dashboard: DashboardData,
  state: ReadyState
) => ({
  onProjectSearchQueryChange: (query: string) => {
    const projects = filterProjectSummariesByQuery(dashboard.projects, query)
    state.setProjectSearchQuery(query)
    state.setSelectedProjectId((selectedProjectId) => resolveSearchSelectedProjectId(projects, selectedProjectId))
  }
})
