import * as FileSystem from "@effect/platform/FileSystem"
import { Effect } from "effect"

const readSystemHostname = (): Effect.Effect<string, never, FileSystem.FileSystem> =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.readFileString("/etc/hostname")),
    Effect.map((value) => value.trim()),
    Effect.orElseSucceed(() => "")
  )

// CHANGE: fall back to the system hostname when HOSTNAME is not exported
// WHY: containerized runtimes can have an inspectable Docker hostname without a HOSTNAME env variable
// QUOTE(ТЗ): "Полностью запусти локально и проверь что всё работает"
// REF: user-request-2026-05-27-pr-351-browser-e2e
// SOURCE: n/a
// FORMAT THEOREM: trim(envHostname) != "" -> envHostname; otherwise trim(systemHostname)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: Docker inspection never receives an empty name when the system hostname is non-empty
// COMPLEXITY: O(|envHostname| + |systemHostname|)
export const resolveCurrentContainerName = (
  envHostname: string | undefined,
  systemHostname: string
): string => envHostname?.trim() || systemHostname.trim()

export const readCurrentContainerName = (): Effect.Effect<string, never, FileSystem.FileSystem> =>
  readSystemHostname().pipe(
    Effect.map((systemHostname) => resolveCurrentContainerName(process.env["HOSTNAME"], systemHostname))
  )
