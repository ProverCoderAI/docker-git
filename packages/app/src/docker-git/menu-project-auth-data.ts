import { Effect } from "effect"

import { normalizeOptionalText } from "../shared/optional-text.js"
import { loadProjectAuthSnapshot, runProjectAuthFlow as submitProjectAuthFlow } from "./api-auth-menu-client.js"
import type { MenuError } from "./menu-errors.js"
import type { MenuEnv, ProjectAuthFlow, ProjectAuthSnapshot } from "./menu-types.js"
import type { ProjectItem } from "./project-item.js"

export {
  projectAuthMenuActionByIndex,
  projectAuthMenuLabels,
  projectAuthMenuSize,
  projectAuthSuccessMessage,
  projectAuthViewSteps
} from "./menu-project-auth-shared.js"
export type { ProjectAuthMenuAction, ProjectAuthPromptStep } from "./menu-project-auth-shared.js"

const decodeSnapshot = (
  projectId: string,
  snapshot: ProjectAuthSnapshot | null
): Effect.Effect<ProjectAuthSnapshot, MenuError, MenuEnv> =>
  snapshot === null
    ? Effect.fail({
      _tag: "ApiRequestError",
      method: "GET",
      path: `/projects/${projectId}/auth/menu`,
      message: `Controller returned an invalid project auth snapshot for ${projectId}.`
    })
    : Effect.succeed(snapshot)

export const readProjectAuthSnapshot = (
  project: ProjectItem
): Effect.Effect<ProjectAuthSnapshot, MenuError, MenuEnv> =>
  loadProjectAuthSnapshot(project.projectDir).pipe(
    Effect.flatMap((snapshot) => decodeSnapshot(project.projectDir, snapshot))
  )

export const writeProjectAuthFlow = (
  project: ProjectItem,
  flow: ProjectAuthFlow,
  values: Readonly<Record<string, string>>
): Effect.Effect<void, MenuError, MenuEnv> =>
  submitProjectAuthFlow(project.projectDir, {
    flow,
    label: normalizeOptionalText(values["label"])
  }).pipe(
    Effect.flatMap((snapshot) => decodeSnapshot(project.projectDir, snapshot)),
    Effect.asVoid
  )
