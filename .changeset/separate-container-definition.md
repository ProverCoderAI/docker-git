---
"@prover-coder-ai/docker-git": patch
"@effect-template/lib": patch
---

Separate the container definition from the panel and the backend (issue #412).

The container definition — the pure layer that renders a project's `Dockerfile`,
`entrypoint.sh` and `docker-compose.yml` from a `TemplateConfig` — has been
extracted from the backend package (`@effect-template/lib`) into a new,
dependency-free leaf package `@prover-coder-ai/docker-git-container`. The backend
now depends on it and re-exports the moved symbols, so its public API is
unchanged.

The panel (`@prover-coder-ai/docker-git`) no longer carries a duplicate copy of
the container/backend logic: the dead `packages/app/src/lib` tree (165 files) and
its now-unused `@lib` / `@effect-template/lib` aliases and dependency were
removed. The `no-lib-imports` ESLint rule now forbids the panel from importing
either the backend or the container-definition package, keeping the boundary
enforced.

No runtime behaviour changes: the generated container files are byte-identical
(guaranteed by the unchanged property-based template test suite, which moved to
the new package).
