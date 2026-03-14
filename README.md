# docker-git

`docker-git` создаёт отдельную Docker-среду для каждого репозитория, issue или PR.
По умолчанию управляющие файлы проекта лежат в `~/.docker-git`, а runtime workspace, `.docker-git` state и auth живут внутри Docker-managed volumes контейнера.

## Что нужно

- Docker Engine или Docker Desktop
- Доступ к Docker без `sudo`
- Node.js и `npm`

## Установка

```bash
npm i -g @prover-coder-ai/docker-git
docker-git --help
```

## Авторизация

```bash
docker-git auth github login --web
docker-git auth codex login --web
docker-git auth claude login --web
```

## Пример

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

## Проверка Docker runtime

Воспроизводимая smoke-проверка для Docker runtime и host CLI:

```bash
pnpm run e2e:runtime-volumes-ssh
```

Сценарий доказывает, что контейнер стартует через Docker, runtime state живёт в named volumes, а `docker-git clone --no-ssh` печатает готовую host CLI команду `SSH access: ...`, которая реально подключает в контейнер, показывает workspace context и видит установленный `codex`.

## Подробности

`docker-git --help`
