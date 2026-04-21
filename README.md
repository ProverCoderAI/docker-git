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

- `apply` применяет конфиг к одному проекту. `--no-up` только обновляет файлы без `docker compose up`. В текущем API-only host mode команда ещё недоступна.
- `apply-all` применяет конфиг ко всем проектам. `--active` только к запущенным контейнерам.


Для запуска WEB версии:
```bash
bun run docker-git -- browser
```

## Подробности

```bash
docker-git --help
```
