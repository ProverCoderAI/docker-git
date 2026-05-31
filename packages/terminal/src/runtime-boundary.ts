import type { Context } from "effect"
import { Effect, Layer } from "effect"

/**
 * Builds a no-op runtime boundary layer through Effect dependency injection.
 *
 * @pure false - constructs an Effect Layer for shell/runtime boundaries.
 * @param tag - Runtime service tag that will receive the service implementation.
 * @param service - Immutable no-op service implementation.
 * @returns Layer that provides the supplied service without external effects.
 * @invariant The returned layer provides exactly the supplied Context.Tag.
 * @precondition service methods are total no-op Effect values.
 * @postcondition Building the layer performs no host IO.
 * @complexity O(1)
 */
// CHANGE: share the terminal runtime Layer constructor.
// WHY: runtime boundary modules should use the same Effect.gen Layer pattern without duplicated shell code.
// QUOTE(ТЗ): "Делаем то что говорит rabbit"
// REF: coderabbit-runtime-boundary
// SOURCE: n/a
// FORMAT THEOREM: ∀tag,service: provides(make(tag,service), tag) = service
// PURITY: SHELL
// EFFECT: Layer<Identifier, never, never>
// INVARIANT: construction is injectable through Context.Tag and performs no host effects.
// COMPLEXITY: O(1)/O(1)
export const makeTerminalRuntimeBoundaryLayer = <Identifier, Service>(
  tag: Context.Tag<Identifier, Service>,
  service: Service
): Layer.Layer<Identifier> =>
  Layer.effect(
    tag,
    Effect.gen(function*(_) {
      yield* _(Effect.void)
      return service
    })
  )
