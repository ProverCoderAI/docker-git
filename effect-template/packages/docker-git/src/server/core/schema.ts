import * as Schema from "effect/Schema"

export const ProjectIdPattern = /^(?!.*\.{2})[a-zA-Z0-9._-]+$/

// CHANGE: define a safe project id schema for URL params
// WHY: prevent path traversal and keep IDs deterministic
// QUOTE(ТЗ): "оркестратор ... управляем всеми докер образами проектов"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall id: valid(id) -> id matches /^[a-zA-Z0-9._-]+$/
// PURITY: CORE
// EFFECT: Effect<Schema, never, never>
// INVARIANT: non-empty, no slashes
// COMPLEXITY: O(1)
export const ProjectIdSchema = Schema.NonEmptyString.pipe(
  Schema.pattern(ProjectIdPattern)
)

export const ProjectParamsSchema = Schema.Struct({
  projectId: ProjectIdSchema
})
