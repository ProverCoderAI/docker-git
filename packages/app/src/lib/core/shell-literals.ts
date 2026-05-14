// CHANGE: centralize POSIX shell literal rendering for generated scripts
// WHY: Dockerfile RUN and entrypoint fragments share the same shell injection boundary
// QUOTE(ТЗ): n/a
// REF: PR-281-coderabbit-targetDir-shell-escape
// SOURCE: n/a
// FORMAT THEOREM: forall s: shell_eval(shellSingleQuote(s)) = s
// PURITY: CORE
// INVARIANT: single quotes in the source value are represented by the POSIX '"'"' sequence
// COMPLEXITY: O(n)/O(n) where n = |value|
/**
 * Renders a POSIX single-quoted shell literal.
 *
 * @param value - Untrusted string that will be embedded into generated shell code.
 * @returns Shell literal that evaluates back to `value`.
 * @pure true
 * @effect none; CORE renderer only transforms a string.
 * @invariant returned literals never leave source single quotes unescaped.
 * @precondition the output is consumed by POSIX-compatible shell syntax.
 * @postcondition command substitution characters remain data, not executable syntax.
 * @complexity O(n) time / O(n) space where n = |value|.
 */
export const shellSingleQuote = (value: string): string => `'${value.replaceAll("'", "'\"'\"'")}'`
