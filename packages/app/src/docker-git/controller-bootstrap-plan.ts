export type ControllerComposeUpPlan = {
  readonly buildController: boolean
  readonly forceRecreateController: boolean
}

export type ControllerImageBuildInput = {
  readonly localControllerRevision: string
  readonly currentControllerRevision: string | null
  readonly currentImageRevision: string | null
  readonly forceRecreateController: boolean
}

/**
 * Renders the docker compose `up` arguments for the controller bootstrap plan.
 *
 * @param plan - Immutable build/recreate decision.
 * @returns Compose arguments preserving the fixed `up -d` prefix.
 *
 * @pure true
 * @effect n/a
 * @invariant `--build` is present iff `plan.buildController`.
 * @precondition Plan booleans are already resolved from Docker state.
 * @postcondition Returned arguments contain no duplicate compose flags.
 * @complexity O(1) time and O(1) space.
 * @throws Never
 */
// CHANGE: derive docker compose up flags from explicit bootstrap requirements
// WHY: matching controller images should be started without invalidating Docker build cache
// QUOTE(ТЗ): "хочу сузить время билда докер контейнера"
// REF: user-request-2026-05-22-controller-build-speed
// SOURCE: n/a
// FORMAT THEOREM: forall p: build(p) <=> "--build" in args(p)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: forceRecreateController controls only --force-recreate
// COMPLEXITY: O(1)
export const resolveControllerComposeUpArgs = (
  plan: ControllerComposeUpPlan
): ReadonlyArray<string> => [
  "up",
  "-d",
  ...(plan.buildController ? ["--build"] : []),
  ...(plan.forceRecreateController ? ["--force-recreate"] : [])
]

/**
 * Decides whether the controller image must be rebuilt before `docker compose up`.
 *
 * @param input - Current controller/image revisions and recreate requirement.
 * @returns `true` only when neither reusable Docker object proves the local revision.
 *
 * @pure true
 * @effect n/a
 * @invariant A matching image revision is sufficient proof to skip build.
 * @precondition Revisions are normalized controller revision strings or null.
 * @postcondition Forced recreation rebuilds only when no matching image exists.
 * @complexity O(1) time and O(1) space.
 * @throws Never
 */
// CHANGE: decide whether controller bootstrap needs a Docker image build
// WHY: source revision can be satisfied by either the existing container or an already-built image
// QUOTE(ТЗ): "контейнер собирается минут 5-6"
// REF: user-request-2026-05-22-controller-build-speed
// SOURCE: n/a
// FORMAT THEOREM: image_rev = local_rev -> build_required = false
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: forced recreation without a matching image requires a rebuild
// COMPLEXITY: O(1)
export const shouldBuildControllerImage = (input: ControllerImageBuildInput): boolean => {
  if (input.currentImageRevision === input.localControllerRevision) {
    return false
  }

  return input.currentControllerRevision !== input.localControllerRevision || input.forceRecreateController
}
