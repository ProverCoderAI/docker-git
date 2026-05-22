import type { GpuMode } from "./frontend-lib/core/domain.js"
import type { CreateInputs } from "./menu-types.js"

export const createProjectDraftFromInputs = (
  input: CreateInputs
): {
  readonly repoUrl: string
  readonly repoRef: string
  readonly outDir: string
  readonly cpuLimit: string
  readonly ramLimit: string
  readonly gpu: GpuMode
  readonly up: boolean
  readonly enableMcpPlaywright: boolean
  readonly force: boolean
  readonly forceEnv: boolean
} => ({
  repoUrl: input.repoUrl,
  repoRef: input.repoRef,
  outDir: input.outDir,
  cpuLimit: input.cpuLimit,
  ramLimit: input.ramLimit,
  gpu: input.gpu,
  up: input.runUp,
  enableMcpPlaywright: input.enableMcpPlaywright,
  force: input.force,
  forceEnv: input.forceEnv
})
