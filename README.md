# docker-git

`docker-git` создаёт отдельную Docker-среду для каждого репозитория, issue или PR.
По умолчанию проекты лежат в `~/.docker-git`.

## Что нужно

- Bun `1.3+`
- Docker Engine или Docker Desktop
- Доступ к Docker без `sudo`
- Git и OpenSSH client (`ssh`, `ssh-keygen`)
- GitHub CLI `gh` для `docker-git auth github login --web`

`Node.js` не является основным runtime для `docker-git`: CLI и workspace запускаются через Bun.
Node всё ещё устанавливается внутри создаваемых Docker-сред, потому что часть агентских CLI зависит от Node ecosystem.

## Установка

```bash
bun add -g @prover-coder-ai/docker-git
docker-git --help
```

Локальный запуск из репозитория:

```bash
bun install
bun run docker-git --help
```

## Авторизация

```bash
docker-git auth github login --web
docker-git auth codex login --web
docker-git auth claude login --web
```

## CLI пример

Можно передавать ссылку на репозиторий, ветку (`/tree/...`), issue или PR.

```bash
docker-git clone https://github.com/ProverCoderAI/docker-git/issues/122 --force --mcp-playwright
```

- `--force` пересоздаёт окружение и удаляет volumes проекта.
- `--mcp-playwright` включает Playwright MCP и Chromium sidecar для браузерной автоматизации.

Автоматический запуск агента:

```bash
docker-git clone https://github.com/ProverCoderAI/docker-git/issues/122 --force --auto
```

- `--auto` сам выбирает Claude или Codex по доступной авторизации. Если доступны оба, выбор случайный.
- `--auto=claude` или `--auto=codex` принудительно выбирает агента.
- В auto-режиме агент сам выполняет задачу, создаёт PR и после завершения контейнер очищается.

## Browser frontend

Browser UI использует тот же backend-контракт, что и CLI. API находится в `packages/api`,
а frontend shell в `packages/app`.

Dev-режим:

```bash
bun install
bun run api:start
```

Во втором терминале:

```bash
bun run web:dev
```

Открой `http://127.0.0.1:4174/`.

Preview собранного frontend:

```bash
bun run web:build
bun run web:serve
```

Открой `http://127.0.0.1:4191/`.
`web:serve` проксирует `/api` и WebSocket terminal-сессии в API на `127.0.0.1:3334`.

## Архитектура workspace

- `packages/app` — CLI/Web frontend, renderer, API client.
- `packages/api` — HTTP/WebSocket controller, единственный backend entrypoint для frontend.
- `packages/lib` — бизнес-логика, Docker/SSH/usecase слой.

Frontend не должен напрямую вызывать бизнес-логику из `packages/lib`; он работает через `packages/api`.

## Проверки

```bash
bun run typecheck
bun run lint
bun run lint:effect
bun run test
```

E2E:

```bash
bun run e2e
```

## Подробности

```bash
docker-git --help
```
