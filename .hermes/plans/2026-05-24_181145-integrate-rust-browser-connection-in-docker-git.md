# План: внедрить rust-browser-connection в docker-git и удалить старую browser/MCP-логику

## Goal

Внедрить созданный Rust-инструмент `ProverCoderAI/rust-browser-connection` в `ProverCoderAI/docker-git` так, чтобы docker-git больше не содержал собственную TS/shell-логику создания browser/noVNC/CDP runtime, а только:

1. устанавливал Rust-бинарники из `rust-browser-connection`;
2. делегировал создание/переиспользование browser-контейнера Rust lifecycle binary;
3. настраивал MCP клиентов на `browser-connection`, а не на старый `docker-git-playwright-mcp` / `@playwright/mcp` wrapper;
4. сохранял инвариант: один проект = один `dg-*-browser` контейнер, один Chromium session, общий для noVNC и MCP.

## Current context / assumptions

- Target repo обнаружен локально: `/home/dev/app`.
- Remote: `https://github.com/ProverCoderAI/docker-git.git`.
- Текущая ветка: `feat/rust-browser-connection-module`.
- Working tree чистый.
- Ветка уже содержит частичную интеграцию Rust-модуля, но она не финальная:
  - старые файлы `playwright-browser.ts`, `playwright-browser-runtime.ts`, `playwright.ts` уже удалены в `packages/app` и `packages/lib`;
  - Dockerfile уже ставит `docker-git-browser-connection` через `cargo install`;
  - entrypoint уже вызывает `docker-git-browser-connection start`;
  - но всё ещё остаётся старый `docker-git-playwright-mcp` wrapper и конфиги MCP клиентов продолжают указывать на него.
- Текущий `origin/main` отличается от branch; перед PR нужно обновиться от `origin/main` или создать свежую ветку и перенести нужные изменения.
- Rust repo `/home/dev/rust-browser-connection` на main содержит два бинарника:
  - `docker-git-browser-connection` — lifecycle CLI: `start/status` browser-контейнера;
  - `browser-connection` — MCP stdio server, который сам starts/reuses Rust-managed browser.
- README `rust-browser-connection` требует использовать в MCP config именно:
  - `command = "browser-connection"`
  - `args = ["--project", "dg-my-project"]`
- В docker-git есть зеркальные области `packages/lib/...` и `packages/app/...`; менять нужно обе, иначе тесты/сборка разойдутся.

## Proposed approach

Сделать интеграцию в два слоя:

1. Browser lifecycle для noVNC/UI:
   - docker-git entrypoint не создаёт browser сам;
   - он вызывает Rust binary `docker-git-browser-connection start --project <project-container> --network container:<project-container>`;
   - Rust binary отвечает за Docker container/image/volume/network/ports и single-session invariant.

2. MCP для Codex/Claude/Gemini/Grok/Hermes-like clients:
   - удалить generated wrapper `/usr/local/bin/docker-git-playwright-mcp`;
   - больше не ставить `@playwright/mcp` для этого пути;
   - все MCP configs должны указывать на `browser-connection`;
   - args должны передавать project id и тот же network mode:
     - `--project`, `$DOCKER_GIT_PROJECT_CONTAINER_NAME`
     - `--network`, `container:$DOCKER_GIT_PROJECT_CONTAINER_NAME`
   - `browser-connection` сам starts/reuses тот же browser-контейнер, поэтому noVNC и MCP не расходятся.

## Step-by-step plan

### 1. Подготовить clean integration branch

- Из `/home/dev/app`:
  - проверить `git status`;
  - обновить refs: `git fetch origin`;
  - либо rebase текущей `feat/rust-browser-connection-module` на `origin/main`, либо создать свежую branch от `origin/main` и перенести только нужные изменения.
- Цель: PR должен быть понятным и не тащить случайные старые/плановые файлы, кроме осознанных изменений.

### 2. Установка Rust tool в generated Dockerfile

Файлы:

- `packages/lib/src/core/templates/dockerfile-prelude.ts`
- `packages/app/src/lib/core/templates/dockerfile-prelude.ts`

Изменить install block так, чтобы он ставил оба бинарника:

```dockerfile
RUN cargo install --git https://github.com/ProverCoderAI/rust-browser-connection --rev c36f263ebc5d0acdf155113914f08cafefa69c56 --locked --bins --root /usr/local \
  && /usr/local/bin/docker-git-browser-connection --version \
  && /usr/local/bin/browser-connection --version
```

Обновить formal comments:

- FORMAT THEOREM: image build produces both `/usr/local/bin/docker-git-browser-connection` and `/usr/local/bin/browser-connection`.
- INVARIANT: docker-git delegates browser lifecycle and MCP stdio to Rust binaries from the separate repo.

### 3. Удалить старый Playwright MCP wrapper из Dockerfile

Файлы:

- удалить или перестать импортировать:
  - `packages/lib/src/core/templates/dockerfile-playwright-mcp.ts`
  - `packages/app/src/lib/core/templates/dockerfile-playwright-mcp.ts`
- обновить:
  - `packages/lib/src/core/templates/dockerfile.ts`
  - `packages/app/src/lib/core/templates/dockerfile.ts`

Что убрать:

- `npm install -g @playwright/mcp@...` для browser path;
- создание `/usr/local/bin/docker-git-playwright-mcp`;
- CDP polling wrapper вокруг `playwright-mcp`;
- любые тестовые ожидания, что generated Dockerfile содержит `docker-git-playwright-mcp`.

Что оставить:

- Rust install из `dockerfile-prelude.ts`;
- Node/Bun/Codex/Claude/Gemini/Grok tooling, не связанный с browser MCP wrapper.

### 4. Entry point: lifecycle start только через Rust binary

Файлы:

- `packages/lib/src/core/templates-entrypoint/tasks.ts`
- `packages/app/src/lib/core/templates-entrypoint/tasks.ts`

Сохранить функцию типа `docker_git_start_rust_browser_connection`, но уточнить:

- lifecycle binary ищется как `/usr/local/bin/docker-git-browser-connection` или через `command -v`;
- browser стартует только если `MCP_PLAYWRIGHT_ENABLE=1`;
- project берётся из `DOCKER_GIT_PROJECT_CONTAINER_NAME`, fallback `hostname`;
- network mode: `container:${project_container}`;
- лог: `/var/log/docker-git-browser.log`;
- при ошибке не падать всем container boot, но выставить `MCP_PLAYWRIGHT_ENABLE=0` и показать warning.

Ожидаемая команда в generated shell:

```bash
"$browser_lifecycle_bin" start \
  --project "$project_container" \
  --network "container:${project_container}"
```

Важно: это не новая browser-логика в docker-git; это только вызов внешнего Rust lifecycle binary.

### 5. MCP configs: заменить `docker-git-playwright-mcp` на `browser-connection`

Файлы entrypoint config generation:

- `packages/lib/src/core/templates-entrypoint/codex.ts`
- `packages/app/src/lib/core/templates-entrypoint/codex.ts`
- `packages/lib/src/core/templates-entrypoint/claude.ts`
- `packages/app/src/lib/core/templates-entrypoint/claude.ts`
- `packages/lib/src/core/templates-entrypoint/gemini.ts`
- `packages/app/src/lib/core/templates-entrypoint/gemini.ts`
- `packages/lib/src/core/templates-entrypoint/grok.ts`
- `packages/app/src/lib/core/templates-entrypoint/grok.ts`

Новые значения:

Codex TOML:

```toml
# docker-git: Browser MCP via rust-browser-connection
[mcp_servers.playwright]
command = "browser-connection"
args = ["--project", "<resolved-project-container>", "--network", "container:<resolved-project-container>"]
```

Claude/Gemini/Grok JSON-like configs:

```json
{
  "command": "browser-connection",
  "args": ["--project", "<resolved-project-container>", "--network", "container:<resolved-project-container>"],
  "trust": true
}
```

Для Claude сохранить `type: "stdio"`.

Техническая деталь: в shell entrypoint сначала вычислить:

```bash
DOCKER_GIT_BROWSER_PROJECT="${DOCKER_GIT_PROJECT_CONTAINER_NAME:-$(hostname)}"
DOCKER_GIT_BROWSER_NETWORK="container:${DOCKER_GIT_BROWSER_PROJECT}"
```

и передавать эти env values в node snippets, чтобы JSON/TOML записывались с конкретными строками, а не с нераскрытыми shell placeholders.

### 6. Auth helper defaults тоже заменить на `browser-connection`

Файлы, где initial OAuth/helper settings сейчас ещё пишут старый command:

- `packages/lib/src/usecases/auth-gemini-helpers.ts`
- `packages/app/src/lib/usecases/auth-gemini-helpers.ts`
- `packages/lib/src/usecases/auth-grok-helpers.ts`
- `packages/app/src/lib/usecases/auth-grok-helpers.ts`

Заменить default MCP server:

```ts
command: "browser-connection",
args: [] // или args с project/network, если helper имеет доступ к project env на runtime
```

Если helper не знает project id на момент записи account-level settings, предпочесть пустые args и дать entrypoint runtime sync перезаписать project-specific config при старте container.

### 7. Compose env: оставить только параметры для Rust tool

Файлы:

- `packages/lib/src/core/templates/docker-compose.ts`
- `packages/app/src/lib/core/templates/docker-compose.ts`

Оставить env:

- `MCP_PLAYWRIGHT_ENABLE=1`
- `DOCKER_GIT_PROJECT_CONTAINER_NAME`
- `DOCKER_GIT_BROWSER_CONTAINER_NAME`
- `DOCKER_GIT_BROWSER_IMAGE_NAME`
- `DOCKER_GIT_BROWSER_VOLUME_NAME`
- `DOCKER_GIT_BROWSER_CPU_LIMIT`
- `DOCKER_GIT_BROWSER_RAM_LIMIT`

Не возвращать отдельный compose service `dg-*-browser`; Rust tool сам создаёт/переиспользует browser container.

### 8. Удалить остатки старой TS/browser duplication

Проверить и при необходимости удалить/обновить:

- `packages/lib/src/core/templates-entrypoint/playwright-browser.ts`
- `packages/app/src/lib/core/templates-entrypoint/playwright-browser.ts`
- `packages/lib/src/core/templates/playwright-browser-runtime.ts`
- `packages/app/src/lib/core/templates/playwright-browser-runtime.ts`
- `packages/lib/src/core/templates/playwright.ts`
- `packages/app/src/lib/core/templates/playwright.ts`
- любые `packages/*browser-connection*` локальные копии Rust repo, если появятся.

Verification search после изменений:

```bash
rg "docker-git-playwright-mcp|@playwright/mcp|playwright-browser-runtime|Dockerfile.browser|mcp-playwright-start-extra|docker-git-cdp-guard" packages
```

Ожидание:

- старый wrapper absent;
- допустимы только исторические changelog/docs references, если они не влияют на runtime/tests.

### 9. Обновить tests

Файлы с текущими ожиданиями старого command/wrapper:

- `packages/lib/tests/core/templates.test.ts`
- `packages/app/tests/docker-git/core-templates.test.ts`
- `packages/lib/tests/usecases/mcp-playwright.test.ts`
- `packages/lib/tests/usecases/auth-gemini.test.ts`
- возможно app-level tests под `packages/app/tests/docker-git/*`.

Новые assertions:

- generated Dockerfile содержит:
  - `cargo install --git https://github.com/ProverCoderAI/rust-browser-connection`
  - `--bins`
  - `browser-connection --version`
  - `docker-git-browser-connection --version`
- generated Dockerfile НЕ содержит:
  - `npm install -g "@playwright/mcp`
  - `/usr/local/bin/docker-git-playwright-mcp`
- generated entrypoint содержит:
  - `docker_git_start_rust_browser_connection`
  - `docker-git-browser-connection start`
  - `browser-connection`
  - `--project`
  - `--network`
- generated configs содержат:
  - `command = "browser-connection"` для Codex;
  - `command: "browser-connection"` / JSON equivalent для Claude/Gemini/Grok;
  - не содержат `docker-git-playwright-mcp`.

### 10. Local verification before PR

Запустить из `/home/dev/app`:

```bash
bun run --filter @effect-template/lib typecheck
bun run --filter @effect-template/lib test
bun run --filter @prover-coder-ai/docker-git typecheck
bun run --filter @prover-coder-ai/docker-git test
bun run check
```

Статические проверки:

```bash
rg "docker-git-playwright-mcp|@playwright/mcp|playwright-browser-runtime|Dockerfile.browser|mcp-playwright-start-extra|docker-git-cdp-guard" packages
rg "command = \"browser-connection\"|\"command\": \"browser-connection\"|browser-connection" packages
```

Ожидание:

- runtime code не содержит старый wrapper;
- tests отражают Rust-only integration;
- нет локального Rust repo/package copy внутри docker-git.

### 11. Runtime smoke test

После unit/typecheck:

1. Собрать docker-git CLI:

```bash
bun run --cwd packages/app build:docker-git
```

2. Создать test project с browser enabled, например на маленьком repo/issue:

```bash
bun ./packages/app/dist/src/docker-git/main.js clone https://github.com/ProverCoderAI/docker-git/issues/122 --force --mcp-playwright
```

3. Внутри project container проверить:

```bash
which docker-git-browser-connection
which browser-connection
docker-git-browser-connection status --project "$DOCKER_GIT_PROJECT_CONTAINER_NAME"
```

4. Проверить контейнеры:

```bash
docker ps --format '{{.Names}} {{.Ports}}' | grep -- '-browser'
```

5. MCP smoke:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
| browser-connection --project "$DOCKER_GIT_PROJECT_CONTAINER_NAME" --network "container:$DOCKER_GIT_PROJECT_CONTAINER_NAME" --no-start-browser
```

Expected:

- server name `browser-connection`;
- tools: `browser_navigate`, `browser_snapshot`, `browser_evaluate`, etc.

6. noVNC/CDP proof:

- open docker-git Browser UI/noVNC URL;
- navigate via MCP `browser_navigate`;
- visually confirm same noVNC session changed;
- confirm only one browser container for the project.

### 12. PR flow

- Commit with conventional message, e.g.:

```text
feat(browser): delegate MCP/noVNC runtime to rust-browser-connection
```

- Push feature branch.
- Open PR to `main`.
- Include summary:
  - removes docker-git Playwright MCP wrapper;
  - installs Rust binaries from `rust-browser-connection`;
  - uses `browser-connection` in MCP configs;
  - lifecycle uses `docker-git-browser-connection start`;
  - no TS browser creation duplication remains.
- Wait for CI and fix failures.

## Files likely to change

Core generated Dockerfile / entrypoint:

- `packages/lib/src/core/templates/dockerfile-prelude.ts`
- `packages/app/src/lib/core/templates/dockerfile-prelude.ts`
- `packages/lib/src/core/templates/dockerfile.ts`
- `packages/app/src/lib/core/templates/dockerfile.ts`
- `packages/lib/src/core/templates-entrypoint/tasks.ts`
- `packages/app/src/lib/core/templates-entrypoint/tasks.ts`

Remove old wrapper template:

- `packages/lib/src/core/templates/dockerfile-playwright-mcp.ts`
- `packages/app/src/lib/core/templates/dockerfile-playwright-mcp.ts`

MCP config generation:

- `packages/lib/src/core/templates-entrypoint/codex.ts`
- `packages/app/src/lib/core/templates-entrypoint/codex.ts`
- `packages/lib/src/core/templates-entrypoint/claude.ts`
- `packages/app/src/lib/core/templates-entrypoint/claude.ts`
- `packages/lib/src/core/templates-entrypoint/gemini.ts`
- `packages/app/src/lib/core/templates-entrypoint/gemini.ts`
- `packages/lib/src/core/templates-entrypoint/grok.ts`
- `packages/app/src/lib/core/templates-entrypoint/grok.ts`

Auth helper defaults:

- `packages/lib/src/usecases/auth-gemini-helpers.ts`
- `packages/app/src/lib/usecases/auth-gemini-helpers.ts`
- `packages/lib/src/usecases/auth-grok-helpers.ts`
- `packages/app/src/lib/usecases/auth-grok-helpers.ts`

Tests:

- `packages/lib/tests/core/templates.test.ts`
- `packages/app/tests/docker-git/core-templates.test.ts`
- `packages/lib/tests/usecases/mcp-playwright.test.ts`
- `packages/lib/tests/usecases/auth-gemini.test.ts`
- any failing app/API tests that assert the old wrapper name.

Docs/changelog if required by repo convention:

- `README.md` if user-facing flags/help mention old wrapper behavior.
- `changelog.d/<timestamp>_rust_browser_connection_docker_git.md` if CI requires a fragment.

## Risks / tradeoffs / open questions

- `browser-connection` starts the browser on MCP server startup. If entrypoint also calls `docker-git-browser-connection start`, this is still safe only if Rust lifecycle is idempotent. This should be verified in runtime smoke.
- If we remove `@playwright/mcp`, tool names/semantics are now the Rust MCP implementation's tools, not upstream Playwright MCP. That is intended, but tests/docs must reflect it.
- Account-level Gemini/Grok helper defaults may not know project id. Runtime entrypoint sync should remain authoritative and overwrite project-specific MCP config.
- Current branch is behind `origin/main`; rebasing may create conflicts in template/test files.
- Docker build now depends on GitHub cargo install from pinned `rust-browser-connection` rev `c36f263ebc5d0acdf155113914f08cafefa69c56`. Future Rust module upgrades require an intentional rev bump in docker-git.
- Do not create or commit a local copy of the Rust repo under docker-git (`packages/rust-browser-connection`, `packages/browser-connection`, etc.). The separate GitHub repo remains the single source of truth.

## Definition of done

- `rg "docker-git-playwright-mcp|@playwright/mcp" packages` has no runtime hits.
- Generated Dockerfile installs both Rust binaries.
- Generated MCP configs use `browser-connection`.
- Generated entrypoint delegates browser lifecycle to `docker-git-browser-connection`.
- Tests/typecheck pass.
- Runtime smoke proves MCP navigation changes the same noVNC-visible Chromium session.
- PR is open against docker-git `main` with green CI.
