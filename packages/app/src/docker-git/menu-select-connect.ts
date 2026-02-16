import { Effect } from "effect"

import type { ProjectItem } from "@effect-template/lib/usecases/projects"

type ConnectDeps<E, R> = {
  readonly connectWithUp: (
    item: ProjectItem
  ) => Effect.Effect<void, E, R>
  readonly enableMcpPlaywright: (
    projectDir: string
  ) => Effect.Effect<void, E, R>
}

const normalizedInput = (input: string): string => input.trim().toLowerCase()

export const isConnectMcpToggleInput = (input: string): boolean => normalizedInput(input) === "p"

export const buildConnectEffect = <E, R>(
  selected: ProjectItem,
  enableMcpPlaywright: boolean,
  deps: ConnectDeps<E, R>
): Effect.Effect<void, E, R> =>
  enableMcpPlaywright
    ? deps.enableMcpPlaywright(selected.projectDir).pipe(
      Effect.zipRight(deps.connectWithUp(selected))
    )
    : deps.connectWithUp(selected)
