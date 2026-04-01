import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import { Effect } from "effect"

import { trimLeftChar, trimRightChar } from "../core/strings.js"
import type { DockerAuthSpec } from "../shell/docker-auth.js"

type DockerAuthSpecInput = {
  readonly cwd: string
  readonly image: string
  readonly hostPath: string
  readonly containerPath: string
  readonly entrypoint?: string
  readonly env?: string | ReadonlyArray<string>
  readonly args: ReadonlyArray<string>
  readonly interactive: boolean
}

// CHANGE: normalize auth account labels for filesystem paths
// WHY: ensure consistent directory names across auth providers
// QUOTE(ТЗ): "система авторизации"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall l: label(l) -> normalized(l)
// PURITY: CORE
// INVARIANT: output is lowercase with hyphen separators
// COMPLEXITY: O(n)
export const normalizeAccountLabel = (value: string | null, fallback: string): string => {
  const trimmed = value?.trim() ?? ""
  if (trimmed.length === 0) {
    return fallback
  }
  const normalized = trimmed.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")
  const withoutLeading = trimLeftChar(normalized, "-")
  const cleaned = trimRightChar(withoutLeading, "-")
  return cleaned.length > 0 ? cleaned : fallback
}

// CHANGE: build docker auth specs from common inputs
// WHY: avoid duplication in gh/codex auth flows
// QUOTE(ТЗ): "поднимал отдельный контейнер где будет установлен чисто gh или чисто codex"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall i: spec(i) -> dockerAuthSpec(i)
// PURITY: CORE
// INVARIANT: volume host/container paths are preserved
// COMPLEXITY: O(1)
export const buildDockerAuthSpec = (input: DockerAuthSpecInput): DockerAuthSpec => ({
  cwd: input.cwd,
  image: input.image,
  volume: { hostPath: input.hostPath, containerPath: input.containerPath },
  ...(typeof input.entrypoint === "string" ? { entrypoint: input.entrypoint } : {}),
  ...(input.env === undefined ? {} : { env: input.env }),
  args: input.args,
  interactive: input.interactive
})

// CHANGE: add isRegularFile helper for auth modules
// WHY: deduplicate file existence checks across Claude and Gemini auth
// QUOTE(ТЗ): "система авторизации"
// REF: issue-146
// SOURCE: n/a
// FORMAT THEOREM: forall p: isRegularFile(fs, p) = true iff exists(p) ∧ type(p) = "File"
// PURITY: SHELL
// EFFECT: Effect<boolean, PlatformError>
// INVARIANT: returns false for directories, symlinks, and non-existent paths
// COMPLEXITY: O(1)
export const isRegularFile = (
  fs: FileSystem.FileSystem,
  filePath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const exists = yield* _(fs.exists(filePath))
    if (!exists) {
      return false
    }
    const info = yield* _(fs.stat(filePath))
    return info.type === "File"
  })
