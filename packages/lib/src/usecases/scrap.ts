import { Effect } from "effect"

import type { ScrapExportCommand, ScrapImportCommand } from "../core/domain.js"
import { ensureDockerDaemonAccess } from "../shell/docker.js"
import { exportScrapCache, importScrapCache } from "./scrap-cache.js"
import { exportScrapSession, importScrapSession } from "./scrap-session.js"
import type { ScrapError, ScrapRequirements } from "./scrap-types.js"

export { deriveScrapWorkspaceRelativePath } from "./scrap-path.js"
export type { ScrapError } from "./scrap-types.js"

export const exportScrap = (
  command: ScrapExportCommand
): Effect.Effect<void, ScrapError, ScrapRequirements> =>
  Effect.gen(function*(_) {
    yield* _(ensureDockerDaemonAccess(process.cwd()))
    yield* _(command.mode === "session" ? exportScrapSession(command) : exportScrapCache(command))
  }).pipe(Effect.asVoid)

export const importScrap = (
  command: ScrapImportCommand
): Effect.Effect<void, ScrapError, ScrapRequirements> =>
  Effect.gen(function*(_) {
    yield* _(ensureDockerDaemonAccess(process.cwd()))
    yield* _(command.mode === "session" ? importScrapSession(command) : importScrapCache(command))
  }).pipe(Effect.asVoid)
