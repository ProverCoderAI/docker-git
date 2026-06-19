import type { ProjectResourceLimitRequest } from "../shared/project-resource-request.js"
import type { CreateProjectDraft } from "./api-schema.js"

/**
 * Draft accepted by POST /projects helpers.
 *
 * @pure true - type-only boundary contract.
 * @effect none
 * @invariant includes the base project draft plus optional resource limit fields shared by sync and async create flows.
 * @precondition callers already validated UI input into CreateProjectDraft fields.
 * @postcondition request builders can serialize the same resource fields for both create variants.
 * @complexity O(1).
 * @throws Never.
 */
export type CreateProjectRequestDraft = CreateProjectDraft & ProjectResourceLimitRequest

/**
 * Optional resource-limit fragment serialized into POST /projects request bodies.
 *
 * @pure true - structural type contract only.
 * @effect none
 * @invariant present fields are defined strings; undefined inputs are omitted by optionalProjectResourceFields.
 * @precondition callers construct this value through optionalProjectResourceFields.
 * @postcondition spreading this fragment cannot add undefined Playwright limit fields.
 * @complexity O(1).
 * @throws Never.
 */
export type OptionalProjectResourceFieldsBody = Readonly<{
  readonly playwrightCpuLimit?: Exclude<ProjectResourceLimitRequest["playwrightCpuLimit"], undefined>
  readonly playwrightRamLimit?: Exclude<ProjectResourceLimitRequest["playwrightRamLimit"], undefined>
}>

/**
 * Common POST /projects request body shared by synchronous and asynchronous create flows.
 *
 * @pure true - structural type contract only.
 * @effect none
 * @invariant sync and async create flows share identical non-async fields.
 * @precondition callers construct this value through baseCreateProjectBody.
 * @postcondition openSsh is false and managed authorized keys are enabled for web-created projects.
 * @complexity O(1).
 * @throws Never.
 */
export type BaseCreateProjectBody = Readonly<{
  readonly cpuLimit: CreateProjectDraft["cpuLimit"]
  readonly enableMcpPlaywright: CreateProjectDraft["enableMcpPlaywright"]
  readonly force: CreateProjectDraft["force"]
  readonly forceEnv: CreateProjectDraft["forceEnv"]
  readonly gpu: CreateProjectDraft["gpu"]
  readonly openSsh: false
  readonly outDir: CreateProjectDraft["outDir"]
  readonly ramLimit: CreateProjectDraft["ramLimit"]
  readonly repoRef: CreateProjectDraft["repoRef"]
  readonly repoUrl: CreateProjectDraft["repoUrl"]
  readonly up: CreateProjectDraft["up"]
  readonly useManagedAuthorizedKeys: true
}>

/**
 * Serializes optional Playwright resource limits for project creation requests.
 *
 * @param request - Shared resource limit fields from the validated create draft.
 * @returns Object containing only defined Playwright limit fields.
 *
 * @pure true - deterministic projection from immutable input.
 * @effect none
 * @invariant undefined optional fields are omitted from the request body.
 * @precondition request is a validated web create/apply resource limit request.
 * @postcondition output is safe to spread into a JSON request body.
 * @complexity O(1).
 * @throws Never.
 */
export const optionalProjectResourceFields = (
  request: ProjectResourceLimitRequest
): OptionalProjectResourceFieldsBody => ({
  ...(request.playwrightCpuLimit !== undefined && { playwrightCpuLimit: request.playwrightCpuLimit }),
  ...(request.playwrightRamLimit !== undefined && { playwrightRamLimit: request.playwrightRamLimit })
})

/**
 * Builds the common POST /projects request body used by sync and async flows.
 *
 * @param draft - Validated project creation draft.
 * @returns Shared request body fields without the flow-specific async flag.
 *
 * @pure true - deterministic serialization of create draft fields.
 * @effect none
 * @invariant sync and async create requests share one definition of common fields.
 * @precondition draft fields were validated by the UI create flow.
 * @postcondition output preserves all non-optional project creation fields.
 * @complexity O(1).
 * @throws Never.
 */
export const baseCreateProjectBody = (draft: CreateProjectDraft): BaseCreateProjectBody => ({
  cpuLimit: draft.cpuLimit,
  enableMcpPlaywright: draft.enableMcpPlaywright,
  force: draft.force,
  forceEnv: draft.forceEnv,
  gpu: draft.gpu,
  openSsh: false,
  outDir: draft.outDir,
  ramLimit: draft.ramLimit,
  repoRef: draft.repoRef,
  repoUrl: draft.repoUrl,
  up: draft.up,
  useManagedAuthorizedKeys: true
})
