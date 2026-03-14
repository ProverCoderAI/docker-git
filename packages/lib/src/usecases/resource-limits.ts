import { Effect } from "effect"

import type { TemplateConfig } from "../core/domain.js"
import { withDefaultResourceLimitIntent } from "../core/resource-limits.js"

// CHANGE: backfill default resource limit intent for projects that do not specify it.
// WHY: docker-git should persist the safe 30% CPU/RAM default unless the user overrides it.
// QUOTE(ТЗ): "надо поставить лимит что если контейнер жрёт под максимум то не забивает всё"
// REF: issue-135
// SOURCE: n/a
// FORMAT THEOREM: forall t: missing_limits(t) -> default_intent(resolve(t))
// PURITY: SHELL
// EFFECT: Effect<TemplateConfig, never, never>
// INVARIANT: explicit user limits always win over derived defaults
// COMPLEXITY: O(1)
export const resolveTemplateResourceLimits = (
  template: TemplateConfig
): Effect.Effect<TemplateConfig> => Effect.succeed(withDefaultResourceLimitIntent(template))
