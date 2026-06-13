# ABC-2 File Trace

## Runtime Template

`packages/lib/src/core/templates-entrypoint/tasks.ts`

- Defines clone-cache initialization and mirror refresh.
- Ensures mirror source is used only after successful refresh.
- Repairs mirror `HEAD` before using it as clone source.

`packages/app/src/lib/core/templates-entrypoint/tasks.ts`

- Synchronized application copy of the runtime template.

## Test Coverage

`packages/lib/tests/core/templates.test.ts`

- Captures generated shell invariants for clone-cache behavior.
- Guards against broad remote refs.
- Guards against reintroducing cache use after refresh failure.
- Guards mirror `HEAD` validation/repair before cache source reuse.

