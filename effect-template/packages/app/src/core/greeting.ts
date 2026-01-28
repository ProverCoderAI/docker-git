import { Match } from "effect"

export type GreetingVariant =
  | { readonly kind: "effect" }
  | { readonly kind: "named"; readonly name: string }

/**
 * Formats a greeting message without side effects.
 *
 * @param variant - Non-empty, classified name information.
 * @returns Greeting text composed deterministically.
 *
 * @pure true
 * @invariant variant.kind === "named" ⇒ variant.name.length > 0
 * @complexity O(1) time / O(1) space
 */
export const formatGreeting = (variant: GreetingVariant): string =>
  Match.value(variant).pipe(
    Match.when({ kind: "effect" }, () => "Hello from Effect!"),
    Match.when({ kind: "named" }, ({ name }) => `Hello, ${name}!`),
    Match.exhaustive
  )
