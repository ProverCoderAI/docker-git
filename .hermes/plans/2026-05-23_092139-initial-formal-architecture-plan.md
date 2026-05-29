# Plan: Initial Formalization of Mathematician-Programmer Agent Role

## Goal
Establish strict adherence to the formally verifiable functional architecture defined in AGENTS.md across all agent behaviors, code, and interactions in this workspace. Ensure every response and code artifact is the result of simulated professional discussion among roles (architect Effect/FP, type reviewer, CORE↔SHELL guardian, test engineer). All future work must follow the Deep Research loop, purity rules, Effect-TS monadic composition, mathematical invariants, and verification requirements.

## Current Context / Assumptions
- Workspace: pnpm monorepo (/home/dev/app) with packages/lib (core domain, state-repo, git, SSH, tests) and packages/app.
- Project context file AGENTS.md fully loaded, defining the mathematician-programmer role, FCIS pattern, mandatory libraries (effect, @effect/schema), comment templates, conventional commits, and quality gates.
- User interaction so far limited to repeated Russian greetings ("ПРивет") and invocation of the `plan` skill + model switches (now grok-4.20-0309-reasoning).
- No specific feature request yet; task inferred as "activate and operationalize the formal role within the existing Hermes codebase".
- Existing code uses TypeScript but may contain imperative patterns, direct effects, or missing formal documentation that must be brought into compliance.
- Tools (terminal, file, search_files, etc.) available and must be used only through typed Effect Services in SHELL.

## Proposed Approach
Adopt the Functional Core, Imperative Shell (FCIS) pattern strictly:
- CORE: pure functions, immutable data, mathematical operations, invariant checks, role-simulation logic.
- SHELL: all tool calls (write_file, terminal, search_files, skill_*, delegate_task, etc.), I/O, model interactions wrapped in Effect + Layers.
- Use @effect/schema for all boundary decoding.
- Encode AGENTS.md rules as types, branded types, and property-based tests.
- Create a central `FormalReasoning` service that forces every action through the required internal steps (Deep Research question → existing pattern search → formalization → code/tests → verification).
- Minimal changes first: add supporting types and a new core module, then enforce via lint rules/architecture tests.

## Step-by-Step Plan
1. Inspect existing core files (domain.ts, auto-agent-flags.ts) using read-only tools to identify reuse opportunities (minimal correct diff principle).
2. Define new CORE types and pure functions:
   - RoleSimulation (architect, reviewer, guardian, test-engineer).
   - Invariant type and checker.
   - `formalizeTask(description: string): Effect<Plan, never, never>` (pure where possible).
3. Create SHELL Layer that provides typed wrappers for all available tools as Effect services (following the DatabaseService/HttpService example in AGENTS.md).
4. Implement the comment template enforcement as a ts-morph script or ESLint rule.
5. Add property-based tests for key invariants (purity, exhaustiveness, no `any`/casts outside axiomatic module).
6. Update main agent entrypoint to load the new FormalReasoning layer.
7. Write this plan file (only mutation allowed this turn).
8. In subsequent turns: implement, test, verify with `npm run lint`, `npm test`, architecture checks.

## Files Likely to Change
- `packages/lib/src/core/domain.ts` (add formal types, invariants, role simulation)
- `packages/lib/src/core/formal-reasoning.ts` (new CORE module)
- `packages/lib/src/core/shell.ts` (new Layer definitions for tools)
- `packages/lib/tests/formal-verification/invariants.test.ts` (new)
- `.hermes/plans/*.md` (ongoing plans)
- `packages/lib/tests/usecases/...` (update existing tests to use Effect.provide and .effect)
- `tsconfig.json`, `pnpm-workspace.yaml` (if new packages needed)

## Tests / Validation
- **Property-based**: `fc.assert(fc.property(taskArbitrary, (task) => isFormalReasoningCompliant(formalizeTask(task))))`
- **Unit**: Effect tests with Mock layers for all tools (`it.effect(...)` with `Effect.provide(MockTerminal)`)
- **Architecture**: Static checks for:
  - No `any`, `as`, `ts-ignore`, `async/await`, `console.*` in CORE.
  - All pattern matches use `Match.exhaustive`.
  - CORE imports only pure modules.
- Run full suite: `npm run lint && npm test && npm run build`
- Verification command sequence (to be executed in future turns):
  ```bash
  npm run lint
  npm test -- --grep="formal|invariant|effect"
  grep -r "any\|as \|ts-ignore" packages/lib/src/core/
  ```

## Risks, Tradeoffs, and Open Questions
- **Risk**: Large-scale refactor of existing Hermes codebase could introduce regressions in SSH/git/state management features. Mitigate with incremental PRs + CI.
- **Tradeoff**: Extreme formalism increases correctness and maintainability at cost of development speed. Prioritize high-risk modules first (tool usage, delegation).
- **Open Questions**:
  - How to mathematically model the "tool call XML format" and "mandatory tool use" rules as invariants?
  - Should the plan skill itself be formalized as a pure `Plan` ADT with interpreter in SHELL?
  - Handling of model switch notes and meta-instructions – treat as SHELL configuration?
  - Exact mapping of "Deep Research" loop into Effect.gen() generator.
- **Assumption to validate**: Existing test files can be migrated to `it.effect()` without breaking.

## Mathematical Guarantees (Proof Obligations)
- Invariant: ∀f ∈ CORE: isPure(f) ∧ preservesInvariants(f)
- ∀response: followsRoleSimulation(response) → contains(DeepResearchQuestion, response)
- Variant: complexity decreases with each research → implementation → verification iteration.

**Next Action (post-plan)**: Load this plan, begin step 1 with read-only inspection, then move to implementation turn.

SOURCE: n/a (directly derived from loaded AGENTS.md)
REF: AGENTS.md + plan skill invocation
