# Architecture compliance audit

Дата аудита: 2026-06-18

Источник требований: [ProverCoderAI/architecture-skills#1](https://github.com/ProverCoderAI/architecture-skills/issues/1).

## Summary

Текущая кодовая база частично соответствует требованиям. В проекте уже есть сильная
база: monorepo, CI с build/typecheck/lint/test/e2e, Effect lint profile,
property-based tests и jscpd в части пакетов. По строгой трактовке issue
репозиторий пока нельзя считать соответствующим: есть крупные нарушения по
размеру модулей, файлов и функций; OpenAPI/generated client отсутствует;
mutation testing отсутствует; coverage не enforced в CI; API `lint:effect` не
подключён в CI; остаются прямые `fetch`, `unknown` и casts.

Строгость оценки: strict with documented exceptions. Boundary `unknown`
допустим только при явном schema decoding и без утечки в domain API.

## Audit matrix

| Требование | Статус | Evidence |
| --- | --- | --- |
| File size <= 400 lines | Fail | 33 tracked TS code files exceed 400 lines. Largest: `packages/api/src/http.ts` 2121, `packages/api/src/services/federation.ts` 1916, `packages/api/src/services/terminal-sessions.ts` 1836. |
| Function size <= 50 lines | Fail | 270 functions exceed 50 lines. Largest: `makeRouter` in `packages/api/src/http.ts` starts at line 942 and spans about 1179 lines. |
| Parameters <= 5 | Partial | 7 functions exceed the limit. Worst: `packages/api/src/services/terminal-sessions.ts:1203` has 7 params. |
| Nesting depth <= 4 | Partial | 2 functions exceed the limit: `packages/api/src/services/auth-menu.ts:114` depth 7 and `packages/api/src/services/auth-menu.ts:165` depth 5. |
| Cyclomatic complexity <= 8 | Fail | 35 functions exceed the limit. Worst: `packages/api/src/services/projects.ts:449` complexity 36. |
| Suppression comments blocked | Partial | Only 4 `eslint-disable` / TS suppression hits, but they are config-level comments allowing test disables. jscpd suppression is broad: 40 `jscpd:ignore-start` blocks. |
| `any`, `unknown`, dynamic blocked | Partial | Explicit `any`: 0 AST occurrences. `unknown`: 163 AST occurrences; some are legitimate boundary values, but literal policy is not globally enforced. |
| Casts / `as` blocked | Fail | 59 TypeScript casts/type assertions in TS-only audit; broader JS/TS scope found 74. |
| Monorepo modules <= 5000 LOC | Fail | Top packages exceed the limit: app about 48k lines, lib about 28k, api about 26k, terminal about 10k, container about 8k. |
| Folder <= 10 code files | Fail | Top flat folders: `packages/app/src/web` 149 files, `packages/app/src/docker-git` 100, `packages/lib/src/usecases` 77, `packages/api/src/services` 42. |
| No unused dependencies | Partial | `dist-deps-prune` exists for packaged app dependency pruning, but there is no workspace-wide `knip`, `depcheck`, or equivalent unused dependency gate. |
| No unused modules | Partial | TypeScript and ESLint catch local unused symbols, but no workspace-wide unused export/module gate such as `knip` or `ts-prune` was found. |
| No duplicate code | Partial | `.jscpd.json` exists for app/lib/terminal and jscpd dependencies exist in app/lib/terminal/container. API and session-sync lack jscpd config, and many files use `jscpd:ignore`. |
| ORM or typed query layer for DB | Fail / not currently applicable | No Prisma/Drizzle/Kysely/TypeORM/Knex/Effect SqlClient usage was found. Existing DB-related code mainly handles typed database profile/proxy configuration, not database persistence. |
| Swagger/OpenAPI generated client | Fail | No OpenAPI/Swagger files or generated API client pipeline found. API schemas and clients appear handwritten with Effect Schema. |
| CI safe `lint --fix` bot flow | Fail | CI runs lint, but no deterministic auto-fix commit/fixed-point workflow was found. |
| Test coverage >= 10% | Partial | Vitest coverage thresholds exist in app/lib/container/terminal configs, but package test scripts and CI run plain `vitest run` without `--coverage`; API and session-sync lack coverage thresholds. |
| Property-based testing for invariants | Pass | `fast-check` is used broadly: 42 files and 77 `fc.property` usages were found. |
| E2E testing | Pass | CI runs 7 E2E jobs in `.github/workflows/check.yml`: local package, browser command, opencode, clone cache, login context, runtime volumes + SSH, clone auto-open SSH. |
| 100% changed code covered in PR | Fail | No diff coverage gate was found. |
| Mutation testing on PR changes | Fail | No Stryker or equivalent mutation testing config/tooling was found. |

## Top blockers

1. `packages/api` is the biggest architectural risk: large files, large functions,
   direct `fetch`, remaining Effect migration warnings, and weak regular ESLint
   enforcement compared with app/lib/container/terminal.
2. OpenAPI/generated-client workflow is absent.
3. Mutation testing and diff coverage are absent.
4. Coverage thresholds exist only partially and are not enforced by CI.
5. Module and folder size limits are not satisfied by current package/folder
   boundaries.
6. Duplication checks are partial and heavily bypassed in copied frontend-lib
   code.

## Recommended PR sequence

1. Enforcement PR: add a read-only architecture audit script for LOC, folder
   width, function size, params, nesting, complexity, casts and direct `fetch`;
   connect API `lint:effect` to CI.
2. Coverage PR: add `test:coverage` scripts, thresholds for API/session-sync,
   and a CI coverage job.
3. Duplication and unused-code PR: add workspace-wide jscpd coverage plus a
   `knip` or equivalent unused dependency/export gate.
4. API contract PR: choose and introduce OpenAPI as source of truth, then
   generate client/types and block handwritten internal API access.
5. Refactor PR series: split the largest API files first:
   `http.ts`, `federation.ts`, `terminal-sessions.ts`, `skiller.ts`.
6. Mutation PR: add mutation testing on changed files after the test/coverage
   baseline is stable.

## Verification commands

The audit used read-only checks only:

```bash
rtk gh issue view 1 --repo ProverCoderAI/architecture-skills --json title,body,comments
rtk rg --files -g 'package.json' -g '*eslint*' -g '*biome*' -g '*jscpd*' -g '*openapi*' -g '*swagger*' -g '*stryker*' -g '*vitest*'
rtk bun run lint:effect
rtk rg -n 'fast-check|fc\\.property|fc\\.assert' packages -g '*.ts' -g '*.tsx'
rtk rg -n '\\bfetch\\(|\\.fetch\\(' packages scripts -g '*.ts' -g '*.tsx' -g '*.mjs'
```

The AST metrics were computed with the TypeScript compiler API against tracked
files under `packages/` and `scripts/`, excluding generated build output.
