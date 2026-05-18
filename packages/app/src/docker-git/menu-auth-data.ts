import { Effect } from "effect"

import { normalizeOptionalText } from "../shared/optional-text.js"
import { loadAuthSnapshot, runAuthMenuFlow as submitAuthMenuFlow } from "./api-auth-menu-client.js"
import type { AuthEnvFlow } from "./menu-auth-shared.js"
import type { MenuError } from "./menu-errors.js"
import type { AuthSnapshot, MenuEnv } from "./menu-types.js"

export {
  authMenuActionByIndex,
  authMenuLabels,
  authMenuSize,
  authViewSteps,
  authViewTitle,
  successMessage
} from "./menu-auth-shared.js"
export type { AuthEnvFlow, AuthMenuAction, AuthPromptStep } from "./menu-auth-shared.js"

const decodeSnapshot = (snapshot: AuthSnapshot | null): Effect.Effect<AuthSnapshot, MenuError, MenuEnv> =>
  snapshot === null
    ? Effect.fail({
      _tag: "ApiRequestError",
      method: "GET",
      path: "/auth/menu",
      message: "Controller returned an invalid auth snapshot."
    })
    : Effect.succeed(snapshot)

export const readAuthSnapshot = (
  _cwd: string
): Effect.Effect<AuthSnapshot, MenuError, MenuEnv> =>
  loadAuthSnapshot().pipe(Effect.flatMap((snapshot) => decodeSnapshot(snapshot)))

export const writeAuthFlow = (
  _cwd: string,
  flow: AuthEnvFlow,
  values: Readonly<Record<string, string>>
): Effect.Effect<void, MenuError, MenuEnv> =>
  submitAuthMenuFlow({
    flow,
    label: normalizeOptionalText(values["label"]),
    token: normalizeOptionalText(values["token"]),
    user: normalizeOptionalText(values["user"]),
    apiKey: normalizeOptionalText(values["apiKey"])
  }).pipe(
    Effect.flatMap((snapshot) => decodeSnapshot(snapshot)),
    Effect.asVoid
  )
