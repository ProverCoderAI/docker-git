# docker-git

`docker-git` создаёт отдельную Docker-среду для каждого репозитория, issue или PR.
По умолчанию проекты лежат в `~/.docker-git`.

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

Применение конфигурации:

```bash
docker-git apply
docker-git apply --no-up
docker-git apply-all
docker-git apply-all --active
```

- `apply` применяет конфиг к одному проекту. `--no-up` только обновляет файлы без `docker compose up`.
- `apply-all` применяет конфиг ко всем проектам. `--active` только к запущенным контейнерам.


Для запуска WEB версии:
```bash
bun run docker-git -- browser
```

По умолчанию web-версия слушает все интерфейсы хоста (`0.0.0.0`), поэтому её можно открыть с другого устройства в LAN, например `http://192.168.0.206:4174/`. Чтобы ограничить доступ только этой машиной:
```bash
DOCKER_GIT_WEB_HOST=127.0.0.1 bun run docker-git -- browser
```

## Подробности

```bash
docker-git --help
```

Структура проекта:
APP - CLI + React (Frontend)
LIB - Весь бекенд (Основная бизнес логика)
API - Просто апи сервер поднятный над LIB 

APP работает только с API, и не имеет доступа к LIB
API работает только с LIB

## Runtime contract: host-Docker-backed

`docker-git` is host-Docker-backed by design. The controller container
(`docker-git-api`) talks to the host Docker daemon via the bind-mounted
`/var/run/docker.sock`, which is how it creates and manages per-project
containers. There is no isolated Docker-in-Docker runtime.

This means the user that runs the host CLI (`bun run docker-git ...`) needs
to be able to talk to that same socket directly. Three failure modes can
look superficially identical and are diagnosed separately by the CLI:

1. **Host Docker daemon is not reachable** – `docker info` fails with
   "Cannot connect to the Docker daemon". Start Docker (e.g.
   `sudo systemctl start docker`) or set `DOCKER_HOST` to a reachable
   endpoint.
2. **Host Docker socket rejected this user** – `docker info` fails with
   "permission denied" while talking to `/var/run/docker.sock`. This is a
   host configuration issue, *not* a `docker-git` outage. Add the user to
   the `docker` group, switch to rootless Docker, or fix the socket
   ownership (`root:docker`, mode `660`). After changing groups, log out
   and back in (or run `newgrp docker`).
3. **Controller container not running** – the host CLI cannot reach
   `docker-git-api` on its API port. Bring the controller up via
   `docker compose up -d --build`, or point the CLI at an existing
   controller using `DOCKER_GIT_API_URL`.

When the CLI cannot acquire Docker access it now prints a message that
names the specific failure mode, restates the host-Docker contract, and
lists remediation steps for that exact mode. Implementation lives in
`packages/app/src/docker-git/controller-docker-diagnostics.ts`.

## Resource limits

`docker-git` caps host resource consumption at two layers so a runaway
project (or the controller itself) cannot consume the entire system.

- **Per-project containers** ship with a default limit of `30%` CPU and
  `30%` RAM (resolved against the host on `apply`). Override via
  `--cpu` / `--ram` (or per-project `docker-git.json`).
- **Controller container** (`docker-git-api`) is capped in
  `docker-compose.yml` and `docker-compose.api.yml`. Override via
  environment variables before `./ctl up`:

  | Variable                       | Default | Purpose                              |
  | ------------------------------ | ------- | ------------------------------------ |
  | `DOCKER_GIT_CONTROLLER_CPUS`   | `2.0`   | Maximum CPU cores for the controller |
  | `DOCKER_GIT_CONTROLLER_MEMORY` | `4g`    | Memory + swap cap (matched values)   |
  | `DOCKER_GIT_CONTROLLER_PIDS`   | `4096`  | Maximum PIDs inside the controller   |
