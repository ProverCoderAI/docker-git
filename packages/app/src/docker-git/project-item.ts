import type { ApiProjectDetails } from "./api-project-codec.js"

export type ProjectItem = ApiProjectDetails

export const projectItemFromApiDetails = (project: ApiProjectDetails): ProjectItem => project

export const resolveApiProjectItem = (project: ApiProjectDetails): ProjectItem => projectItemFromApiDetails(project)
