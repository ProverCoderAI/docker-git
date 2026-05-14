import type { GpuMode } from "../docker-git/frontend-lib/core/domain.js"

export type CreateInputs = {
  readonly repoUrl: string
  readonly repoRef: string
  readonly outDir: string
  readonly cpuLimit: string
  readonly ramLimit: string
  readonly gpu: GpuMode
  readonly runUp: boolean
  readonly enableMcpPlaywright: boolean
  readonly force: boolean
  readonly forceEnv: boolean
}

export type CreateStep =
  | "repoUrl"
  | "repoRef"
  | "outDir"
  | "cpuLimit"
  | "ramLimit"
  | "gpu"
  | "runUp"
  | "mcpPlaywright"
  | "force"

export const createSteps: ReadonlyArray<CreateStep> = [
  "repoUrl",
  "cpuLimit",
  "ramLimit",
  "gpu",
  "runUp",
  "mcpPlaywright",
  "force"
]
