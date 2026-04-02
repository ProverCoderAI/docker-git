import { Effect, pipe } from "effect"

import type { AuthGithubStatusCommand } from "@lib/core/domain"
import { connectProjectSsh, type ProjectItem, waitForProjectSshReady } from "@lib/usecases/projects"

import {
  deleteProject,
  downProject,
  getProject,
  githubStatus,
  listProjects,
  readProjectLogs,
  readProjectPs,
  renderProjectSummaryLine,
  upProject
} from "./api-client.js"
import { asObject, asString, type JsonValue } from "./api-json.js"
import type { MenuError } from "./menu-errors.js"
import type { MenuEnv } from "./menu-types.js"
import { resolveApiProjectItem } from "./project-item.js"

const menuGithubStatusCommand = {
  _tag: "AuthGithubStatus",
  envGlobalPath: ""
} satisfies AuthGithubStatusCommand

const compact = <A>(values: ReadonlyArray<A | null>): ReadonlyArray<A> =>
  values.filter((value): value is A => value !== null)

const decodeGithubSummary = (payload: JsonValue): string => {
  const object = asObject(payload)
  const status = asObject(object?.["status"] ?? object)
  return asString(status?.["summary"]) ?? "Controller GitHub auth status loaded."
}

const listProjectDetails = (
  items: ReadonlyArray<Readonly<{ id: string; status: string }>>
) =>
  Effect.forEach(
    items,
    (item) =>
      pipe(
        getProject(item.id),
        Effect.flatMap((project) => (project === null ? Effect.succeed(null) : resolveApiProjectItem(project))),
        Effect.match({
          onFailure: () => null,
          onSuccess: (project) => project
        })
      ),
    { concurrency: 4 }
  )

const renderOutput = (label: string, output: string) =>
  Effect.log(output.trim().length > 0 ? output : `${label}: no output.`)

const listMenuProjectItemsByStatus = (
  status: "running" | null
): Effect.Effect<ReadonlyArray<ProjectItem>, MenuError, MenuEnv> =>
  pipe(
    listProjects(),
    Effect.flatMap((projects) =>
      listProjectDetails(
        (status === null ? projects : projects.filter((project) => project.status === status)).map((project) => ({
          id: project.id,
          status: project.status
        }))
      )
    ),
    Effect.map((projects) => compact(projects))
  )

export const listMenuProjectItems: Effect.Effect<ReadonlyArray<ProjectItem>, MenuError, MenuEnv> =
  listMenuProjectItemsByStatus(null)

export const listMenuRunningProjectItems: Effect.Effect<ReadonlyArray<ProjectItem>, MenuError, MenuEnv> =
  listMenuProjectItemsByStatus("running")

export const renderMenuProjectSummaries = () =>
  pipe(
    listProjects(),
    Effect.flatMap((projects) => {
      if (projects.length === 0) {
        return Effect.log("No docker-git projects found.")
      }

      return Effect.forEach(projects, (project) => Effect.log(renderProjectSummaryLine(project)), {
        discard: true
      })
    })
  )

export const connectMenuProjectSshWithUp = (
  item: ProjectItem
) =>
  pipe(
    upProject(item.projectDir),
    Effect.zipRight(getProject(item.projectDir)),
    Effect.flatMap((project) => {
      const resolved = project === null ? Effect.succeed(item) : resolveApiProjectItem(project)
      return pipe(
        resolved,
        Effect.flatMap((resolvedItem) =>
          pipe(
            waitForProjectSshReady(resolvedItem),
            Effect.zipRight(connectProjectSsh(resolvedItem))
          )
        )
      )
    })
  )

export const deleteMenuProject = (item: ProjectItem) => deleteProject(item.projectDir)

export const downMenuProject = (item: ProjectItem) => downProject(item.projectDir)

export const renderMenuProjectPs = (projectId: string) =>
  pipe(readProjectPs(projectId), Effect.flatMap((output) => renderOutput("docker compose ps", output)))

export const renderMenuProjectLogs = (projectId: string) =>
  pipe(readProjectLogs(projectId), Effect.flatMap((output) => renderOutput("docker compose logs", output)))

export const renderGithubAuthStatusSummary = () =>
  pipe(
    githubStatus(menuGithubStatusCommand),
    Effect.map((payload) => decodeGithubSummary(payload))
  )
