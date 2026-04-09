import { Effect } from "effect"

import type { ProjectItem } from "@lib/usecases/projects"

import { openResolvedProjectSshEffect } from "../../../src/docker-git/open-project.js"

type OpenResolvedProjectSshDeps = {
  readonly log: (message: string) => Effect.Effect<void>
  readonly resolvePreferredItem: (item: ProjectItem) => Effect.Effect<ProjectItem | null>
  readonly probeReady: (item: ProjectItem) => Effect.Effect<boolean>
  readonly connect: (item: ProjectItem) => Effect.Effect<void>
  readonly connectWithUp: (item: ProjectItem) => Effect.Effect<void>
}

type OpenResolvedProjectSshOptions =
  & Partial<
    Omit<OpenResolvedProjectSshDeps, "connect" | "connectWithUp" | "log">
  >
  & {
    readonly connectEntry?: (selected: ProjectItem) => string
    readonly upEntry?: (selected: ProjectItem) => string
  }

const record = (events: Array<string>, entry: string): Effect.Effect<void> =>
  Effect.sync(() => {
    events.push(entry)
  })

export const makeOpenResolvedProjectSshDeps = (
  events: Array<string>,
  options: OpenResolvedProjectSshOptions = {}
): OpenResolvedProjectSshDeps => {
  const { connectEntry, upEntry, ...overrides } = options
  return {
    log: (message) => record(events, `log:${message}`),
    resolvePreferredItem: () => Effect.succeed(null),
    probeReady: () => Effect.succeed(true),
    connect: (selected) => record(events, connectEntry?.(selected) ?? `connect:${selected.projectDir}`),
    connectWithUp: (selected) => record(events, upEntry?.(selected) ?? `up:${selected.projectDir}`),
    ...overrides
  }
}

export const captureOpenResolvedProjectSshEvents = (
  item: ProjectItem,
  options: OpenResolvedProjectSshOptions = {}
): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function*(_) {
    const events: Array<string> = []
    yield* _(openResolvedProjectSshEffect(item, makeOpenResolvedProjectSshDeps(events, options)))
    return events
  })
