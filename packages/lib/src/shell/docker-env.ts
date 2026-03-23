import * as FileSystem from "@effect/platform/FileSystem"
import { Effect } from "effect"

// CHANGE: detect Docker-in-Docker environment using @effect/platform
// WHY: SSH host resolution and path mapping differ in DinD vs host environments;
//      node:fs is banned by Effect-TS lint rules so we use @effect/platform FileSystem
// PURITY: SHELL
// EFFECT: Effect<boolean, never, FileSystem.FileSystem>
// INVARIANT: returns true when /.dockerenv exists (standard Docker indicator)
export const isInsideDockerEffect: Effect.Effect<boolean, never, FileSystem.FileSystem> = FileSystem.FileSystem.pipe(
  Effect.flatMap((fs) => fs.exists("/.dockerenv")),
  Effect.orElseSucceed(() => false)
)
