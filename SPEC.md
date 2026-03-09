# docker-git — Техническое задание (ТЗ)

> Документ описывает что делает система, как она работает и почему.
> Служит основой для переписывания на Rust или любом другом языке.

---

## 1. Что такое docker-git

**docker-git** — CLI-инструмент и HTTP API для создания изолированных Docker-контейнеров разработчика под каждый GitHub-репозиторий (или issue/PR).

**Проблема, которую решает:**
- Вместо того чтобы вручную клонировать репозиторий, настраивать окружение, прокидывать credentials и порты — одна команда создаёт готовое рабочее окружение
- Несколько задач (issue-123, pr-456) в одном репозитории работают **изолированно**, без конфликтов портов
- Credentials (GitHub токены, Codex, Claude API ключи) хранятся **один раз** и переиспользуются всеми контейнерами
- Package cache (pnpm/npm/yarn) **общий** для всех контейнеров — не скачивать зависимости заново

---

## 2. Архитектура системы

```
┌──────────────────────────────────────────────────────┐
│                    Пользователь                       │
│         CLI (docker-git clone <url>)                 │
│         TUI (интерактивное меню)                     │
│         HTTP API (REST)                              │
└────────────────────┬─────────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────────┐
│               Бизнес-логика (CORE)                    │
│  • Парсинг команд         • Генерация шаблонов        │
│  • Управление проектами   • Auth management           │
│  • State repo sync        • Scrap export/import       │
└────────────────────┬─────────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────────┐
│               Внешние системы (SHELL)                 │
│  • Docker CLI             • Git / GitHub API          │
│  • Файловая система       • SSH                       │
│  • Tmux                   • ActivityPub               │
└──────────────────────────────────────────────────────┘
```

---

## 3. Файловая структура на хосте

```
~/.docker-git/                          ← корень всех проектов
├── authorized_keys                     ← публичный SSH ключ хоста
├── .orch/
│   ├── env/
│   │   └── global.env                 ← общие credentials (GH_TOKEN, CLAUDE_KEY и т.д.)
│   └── auth/
│       ├── gh/                        ← gh CLI кэш (shared)
│       └── codex/                     ← Codex auth (shared, если CODEX_SHARE_AUTH=1)
├── .cache/
│   ├── git-mirrors/                   ← зеркала git репозиториев
│   └── packages/
│       ├── pnpm/                      ← общий pnpm store
│       ├── npm/                       ← общий npm cache
│       └── yarn/                      ← общий yarn cache
│
└── <owner>/
    └── <repo>/
        ├── docker-compose.yml
        ├── Dockerfile
        ├── entrypoint.sh
        ├── docker-git.json            ← метаданные проекта
        └── .orch/
            ├── env/
            │   └── project.env        ← per-project overrides
            └── auth/
                └── codex/             ← per-project Codex auth (если не shared)
```

**Workspace (issue/PR):**
Если проект привязан к issue или PR, создаётся подпапка:
```
~/.docker-git/<owner>/<repo>/issue-123/
~/.docker-git/<owner>/<repo>/pr-456/
```

---

## 4. Типы данных

### 4.1 ProjectConfig (хранится в docker-git.json)

```
ProjectConfig {
  repoUrl:       string         // https://github.com/owner/repo
  repoRef:       string         // issue-123 | pr-456 | main
  containerName: string         // dg-owner-repo-issue-123
  sshPort:       u16            // 2222
  networkMode:   NetworkMode    // shared | project
  createdAt:     timestamp
}
```

### 4.2 TemplateConfig (входные данные для генерации шаблонов)

```
TemplateConfig {
  // Имена
  containerName:   string    // dg-owner-repo
  serviceName:     string    // owner-repo
  volumeName:      string    // dg-owner-repo-vol
  networkName:     string    // dg-owner-repo-net | docker-git-shared

  // Пути на хосте
  projectDir:      string    // ~/.docker-git/owner/repo
  authorizedKeys:  string    // ~/.docker-git/authorized_keys
  globalEnvFile:   string    // ~/.docker-git/.orch/env/global.env
  projectEnvFile:  string    // ~/.docker-git/owner/repo/.orch/env/project.env
  codexAuthDir:    string    // ~/.docker-git/.orch/auth/codex | per-project path
  pnpmCacheDir:    string    // ~/.docker-git/.cache/packages/pnpm
  npmCacheDir:     string    // ~/.docker-git/.cache/packages/npm
  yarnCacheDir:    string    // ~/.docker-git/.cache/packages/yarn

  // Параметры
  sshPort:         u16
  networkMode:     NetworkMode
  pnpmVersion:     string    // "10.27.0"
  repoUrl:         string
  repoRef:         string
  agentLabel:      string    // "codex" | "claude" | "none"

  // Опции
  enablePlaywright: bool
  shareCodexAuth:  bool
}
```

### 4.3 ProjectItem (runtime-состояние)

```
ProjectItem {
  projectDir:    string
  displayName:   string    // "owner/repo issue-123"
  repoUrl:       string
  repoRef:       string
  containerName: string
  isRunning:     bool
  sshPort:       u16
}
```

### 4.4 Command (дискриминированный union)

```
Command =
  | Create(CreateParams)
  | Menu
  | Attach(AttachParams)
  | Status
  | DownAll
  | StateInit(StateParams)
  | StatePull | StatePush | StateSync | StateStatus | StateCommit | StatePath
  | AuthGithubLogin(AuthParams) | AuthGithubStatus | AuthGithubLogout
  | AuthCodexLogin(AuthParams)  | AuthCodexStatus  | AuthCodexLogout
  | AuthClaudeLogin(AuthParams) | AuthClaudeStatus  | AuthClaudeLogout
  | ScrapExport(ScrapParams) | ScrapImport(ScrapParams)
  | McpPlaywrightUp(McpParams)
  | SessionsList | SessionsKill | SessionsLogs
  | Apply
```

---

## 5. Команды CLI

### 5.1 `clone` / `create`

Создаёт новый проект из URL репозитория.

**Вход:**
```
docker-git clone <url> [options]
  --port <n>              SSH порт (по умолчанию: автоматически свободный от 2222)
  --name <name>           имя контейнера (по умолчанию: выводится из URL)
  --network-mode          shared | project  (по умолчанию: shared)
  --force                 пересоздать если существует (удалить volumes)
  --force-env             перезаписать только .env файлы
  --run-up / --no-run-up  запускать ли контейнер сразу (по умолчанию: да)
  --open-ssh              открыть SSH сессию после запуска
  --agent                 codex | claude | none
  --enable-mcp-playwright добавить Playwright sidecar
```

**Алгоритм:**

```
1. Распарсить URL:
   - https://github.com/owner/repo          → owner=owner, repo=repo, ref=main
   - https://github.com/owner/repo/issues/N → ref=issue-N
   - https://github.com/owner/repo/pull/N   → ref=pr-N

2. Определить имена (детерминировано из URL):
   slug         = "owner-repo" или "owner-repo-issue-N"
   containerName = "dg-" + slug
   serviceName   = slug
   volumeName    = "dg-" + slug + "-vol"
   projectDir    = ~/.docker-git/owner/repo[/issue-N]

3. Найти свободный SSH порт:
   - Начать с 2222 (или переданного --port)
   - Проверять nc / ss пока порт не будет свободен

4. Проверить существование:
   - Если projectDir существует и нет --force → ошибка "уже существует"
   - Если --force → удалить docker compose volumes, оставить .orch/

5. Создать файлы:
   - Записать Dockerfile (из шаблона)
   - Записать docker-compose.yml (из шаблона)
   - Записать entrypoint.sh (из шаблона, chmod +x)
   - Создать .orch/env/project.env (пустой если не существует)
   - Записать docker-git.json (метаданные)

6. Если --run-up (по умолчанию true):
   - docker compose up -d --build
   - Повторить до 3 раз при DNS/Hub ошибках

7. Если --open-ssh:
   - Подождать пока SSH порт откроется (polling 1s, timeout 60s)
   - Запустить SSH сессию

8. Если настроен state repo:
   - git add + commit + push метаданных
```

---

### 5.2 `menu` (по умолчанию без аргументов)

Интерактивное TUI для управления проектами.

**Алгоритм:**
```
1. Проверить stdin.is_tty()
   - Нет → вывести список проектов в stdout и выйти
   - Да  → запустить TUI

2. TUI состояние:
   view: Menu | Create | Select | AuthMenu
   projects: Vec<ProjectItem>
   selected: Option<usize>
   busy: bool

3. Загрузка при старте:
   - Сканировать ~/.docker-git рекурсивно на docker-git.json
   - Запустить docker ps → список running контейнеров
   - Сопоставить проекты с running статусом

4. Вид Menu:
   - Список проектов (стрелки вверх/вниз для выбора)
   - [Enter] → Select view для выбранного проекта
   - [n] → Create view
   - [a] → AuthMenu view
   - [q] → выход

5. Вид Select (для выбранного проекта):
   - [u] → docker compose up
   - [d] → docker compose down
   - [s] → SSH attach
   - [l] → показать logs
   - [x] → удалить проект
   - [Esc] → назад в Menu

6. Вид Create (форма):
   - Поле: repoUrl (обязательно)
   - Поле: sshPort (default: auto)
   - Поле: agentMode (codex | claude | none)
   - [Enter] → запустить create команду
   - [Esc] → отмена

7. Вид AuthMenu:
   - Управление GitHub / Codex / Claude токенами
```

---

### 5.3 `attach`

Подключиться SSH к запущенному контейнеру.

```
docker-git attach [<project-dir>]
  - Если project-dir не указан → показать меню выбора
  - Читает docker-git.json → sshPort, containerName
  - Проверяет что контейнер запущен (docker ps)
  - Запускает: ssh -i ~/.ssh/id_rsa -p <port> dev@127.0.0.1
  - Наследует stdin/stdout/stderr (интерактивный TTY)
```

---

### 5.4 `status`

Вывести все проекты с их статусом.

```
Выход (таблица):
  ПРОЕКТ                    СТАТУС      ПОРТ    URL
  owner/repo                running     2222    https://github.com/owner/repo
  owner/repo issue-123      stopped     2223    https://github.com/owner/repo/issues/123
```

---

### 5.5 `down-all`

Остановить все запущенные контейнеры docker-git.

```
- Найти все projectDir с docker-git.json
- Для каждого: docker compose down
- Параллельно (но вывод упорядоченный)
```

---

### 5.6 Auth команды

#### `auth github login`
```
Опции:
  --token <value>    Сохранить токен напрямую
  --label <name>     Метка для токена (default: "default")
  --web              Открыть browser OAuth flow

Хранение:
  ~/.docker-git/.orch/env/global.env
  Формат строки: GIT_AUTH_<LABEL>=<token>
                 GH_TOKEN=<token>  (копия для backward compat)
```

#### `auth github status`
```
Вывести: список сохранённых токенов (замаскировать: abcd****efgh)
```

#### `auth github logout`
```
Опции:
  --label <name>    Удалить конкретный токен
  --all             Удалить все
```

Аналогично для `auth codex` и `auth claude`.

---

### 5.7 State команды

Синхронизация метаданных в remote git репозиторий.

```
auth state init <repo-url> [--ref <branch>]
  - Клонировать в ~/.docker-git (как git remote)
  - Или добавить remote к существующему

state sync [--message <msg>]
  - git add ~/.docker-git/.orch/
  - git commit -m <msg>
  - git push (с инжектированным GH_TOKEN если GitHub HTTPS)

state pull
  - git pull (с токеном)

state status
  - git status + git log --oneline -10

state path
  - Вывести путь к state repo
```

---

### 5.8 Scrap (export/import сессий)

```
scrap export <project-dir> <archive-path>
  - Создать .tar.gz с содержимым:
    - .orch/ (env, auth configs, логи)
    - git HEAD commit hash
    - манифест (версия, дата, метаданные)
  - НЕ включать: node_modules, .cache, большие бинарники

scrap import <project-dir> <archive-path> [--wipe]
  - Распаковать архив
  - Если --wipe: docker exec <container> rm -rf /app/*
                 восстановить из git commit hash
  - Восстановить .orch/ файлы
  - docker compose restart если контейнер запущен
```

---

### 5.9 MCP Playwright

```
mcp-playwright up <project-dir>
  - Добавить Chromium сервис в docker-compose.yml проекта:
    Образ: browserless/chromium (или аналог)
    Порт: 3222 (CDP endpoint)
    Сеть: та же что у dev контейнера
  - docker compose up <chromium-service>
  - Записать MCP конфиг в .orch/mcp/playwright.json:
    {
      "command": "docker-git-playwright-mcp",
      "env": { "CDP_ENDPOINT": "http://dg-<slug>-browser:3222" }
    }
  - Записать Claude Code MCP конфиг если Claude включён
```

---

## 6. Генерация шаблонов (CORE — чистые функции)

### 6.1 Dockerfile

```dockerfile
FROM ubuntu:24.04

# Base tools
RUN apt-get update && apt-get install -y \
    git curl wget zsh tmux openssh-server \
    build-essential ca-certificates

# Node.js 24 via nvm
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
RUN . ~/.nvm/nvm.sh && nvm install 24 && nvm use 24

# pnpm (версия из TemplateConfig.pnpmVersion)
RUN npm install -g pnpm@{pnpmVersion}

# Bun
RUN curl -fsSL https://bun.sh/install | bash

# Codex CLI
RUN npm install -g @openai/codex

# oh-my-opencode (бинарный враппер)
RUN curl ... (platform-specific binary)

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# SSH setup
RUN mkdir -p /var/run/sshd && \
    useradd -m -s /bin/zsh dev && \
    echo "dev ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

EXPOSE 22

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]
```

**Инварианты:**
- Один и тот же TemplateConfig → идентичный Dockerfile (детерминировано)
- Версии инструментов зафиксированы в конфиге

---

### 6.2 docker-compose.yml

```yaml
services:
  {serviceName}:
    build: .
    container_name: {containerName}
    restart: unless-stopped

    volumes:
      # SSH авторизация
      - {authorizedKeys}:/home/dev/.ssh/authorized_keys:ro

      # Credentials (read-only для безопасности)
      - {globalEnvFile}:/.docker-git/.orch/env/global.env:ro
      - {projectEnvFile}:/.orch/env/project.env:ro

      # Codex auth (shared или per-project)
      - {codexAuthDir}:/home/dev/.codex

      # Docker socket (для nested docker)
      - /var/run/docker.sock:/var/run/docker.sock

      # Package caches (shared)
      - {pnpmCacheDir}:/home/dev/.docker-git/.cache/packages/pnpm
      - {npmCacheDir}:/home/dev/.docker-git/.cache/packages/npm
      - {yarnCacheDir}:/home/dev/.docker-git/.cache/packages/yarn

      # Workspace volume
      - {volumeName}:/home/dev/workspace

    ports:
      - "{sshPort}:22"

    environment:
      - REPO_URL={repoUrl}
      - REPO_REF={repoRef}
      - AGENT_LABEL={agentLabel}
      - CODEX_SHARE_AUTH={shareCodexAuth}
      - CLAUDE_AUTO_SYSTEM_PROMPT=1

    networks:
      # shared mode:
      - docker-git-shared
      # project mode:
      # - {networkName}

# Playwright sidecar (если enablePlaywright=true):
  {containerName}-browser:
    image: browserless/chromium
    container_name: {containerName}-browser
    ports:
      - "3222"
    networks:
      - docker-git-shared

networks:
  docker-git-shared:
    external: true
  # project mode:
  # {networkName}:
  #   driver: bridge

volumes:
  {volumeName}:
```

---

### 6.3 entrypoint.sh

Bash скрипт, выполняемый при старте контейнера. Состоит из модульных блоков:

**Блок 1: Переменные и пути**
```bash
#!/bin/bash
set -e

REPO_URL="${REPO_URL:-}"
REPO_REF="${REPO_REF:-main}"
TARGET_DIR="/home/dev/workspace"
DOCKER_GIT_ROOT="/.docker-git"
GLOBAL_ENV="$DOCKER_GIT_ROOT/.orch/env/global.env"
PROJECT_ENV="/.orch/env/project.env"
```

**Блок 2: SSH авторизованные ключи**
```bash
# Файл уже смонтирован через volume
# Установить правильные права
chown dev:dev /home/dev/.ssh/authorized_keys
chmod 600 /home/dev/.ssh/authorized_keys
```

**Блок 3: Package cache переменные**
```bash
export PNPM_STORE_DIR="$DOCKER_GIT_ROOT/.cache/packages/pnpm"
export npm_config_cache="$DOCKER_GIT_ROOT/.cache/packages/npm"
export YARN_CACHE_FOLDER="$DOCKER_GIT_ROOT/.cache/packages/yarn"
```

**Блок 4: Docker socket доступ**
```bash
DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
groupadd -g "$DOCKER_GID" dockerhost 2>/dev/null || true
usermod -aG dockerhost dev
```

**Блок 5: Git/GitHub credentials**
```bash
if [ -f "$GLOBAL_ENV" ]; then
  source "$GLOBAL_ENV"
fi
if [ -f "$PROJECT_ENV" ]; then
  source "$PROJECT_ENV"
fi
export GIT_AUTH_TOKEN="${GIT_AUTH_TOKEN:-$GH_TOKEN}"
# Настроить git credential helper
git config --global credential.helper store
echo "https://git:$GIT_AUTH_TOKEN@github.com" > ~/.git-credentials
```

**Блок 6: Codex auth**
```bash
if [ "$CODEX_SHARE_AUTH" = "1" ]; then
  # Shared auth смонтирован в /home/dev/.codex через volume
  echo "Using shared Codex auth"
else
  # Per-project auth
  mkdir -p /home/dev/.codex
fi
```

**Блок 7: Claude Code**
```bash
# Восстановить сессию если есть сохранённая
if [ -f "/.orch/auth/claude/session.json" ]; then
  mkdir -p /home/dev/.config/claude
  cp "/.orch/auth/claude/session.json" /home/dev/.config/claude/
fi

# Auto-attach system prompt если CLAUDE_AUTO_SYSTEM_PROMPT=1
if [ "$CLAUDE_AUTO_SYSTEM_PROMPT" = "1" ] && [ -f "/.orch/env/system-prompt.md" ]; then
  export CLAUDE_SYSTEM_PROMPT="$(cat /.orch/env/system-prompt.md)"
fi
```

**Блок 8: Клонирование репозитория**
```bash
if [ -n "$REPO_URL" ] && [ ! -d "$TARGET_DIR/.git" ]; then
  su - dev -c "git clone '$REPO_URL' '$TARGET_DIR'"
  # Если REPO_REF это issue/PR — создать ветку
  if [[ "$REPO_REF" == issue-* ]] || [[ "$REPO_REF" == pr-* ]]; then
    su - dev -c "cd '$TARGET_DIR' && git checkout -b '$REPO_REF'"
  else
    su - dev -c "cd '$TARGET_DIR' && git checkout '$REPO_REF'"
  fi
fi
```

**Блок 9: Запуск SSH сервера**
```bash
/usr/sbin/sshd -D
```

---

## 7. HTTP API

### Базовый URL
```
http://localhost:{DOCKER_GIT_API_PORT}
```
По умолчанию: `3334`

### Эндпоинты

#### Health
```
GET /health
→ { "status": "ok", "version": "1.0.0" }
```

#### Projects

```
GET /projects
→ [ProjectDetails]

POST /projects
Body: {
  "repoUrl": "https://github.com/owner/repo",
  "repoRef": "main",           // optional
  "containerName": "custom",   // optional
  "force": false,              // optional
  "runUp": true                // optional
}
→ ProjectDetails

GET /projects/:projectId
→ ProjectDetails

DELETE /projects/:projectId
→ { "success": true }

POST /projects/:projectId/up
→ { "success": true }

POST /projects/:projectId/down
→ { "success": true }

GET /projects/:projectId/logs?tail=100
→ text/plain (streaming или snapshot)

GET /projects/:projectId/ps
→ { "containers": [{ "name": "...", "status": "running", "ports": "..." }] }

GET /projects/:projectId/events
→ text/event-stream (SSE)
   data: { "type": "deployment.log", "line": "...", "command": "..." }
   data: { "type": "status.changed", "status": "running" }
```

#### Agents

```
POST /agents/:projectId/start
Body: { "type": "codex" | "claude" }
→ { "agentId": "...", "status": "starting" }

GET /agents/:projectId
→ [{ "agentId": "...", "type": "codex", "status": "running" }]

GET /agents/:projectId/:agentId
→ AgentDetails

DELETE /agents/:projectId/:agentId
→ { "success": true }

GET /agents/:projectId/:agentId/logs
→ text/plain
```

#### Federation (ActivityPub, экспериментальное)

```
GET /.well-known/webfinger?resource=acct:docker-git@{host}
→ WebFinger JSON

GET /actors/docker-git
→ ActivityPub Actor JSON-LD

POST /federation/inbox
Body: ActivityPub Activity (JSON-LD)
→ 202 Accepted

GET /federation/followers
GET /federation/following
→ ActivityPub OrderedCollection

POST /federation/follow
Body: { "actorUrl": "https://other-instance/actors/..." }
→ { "success": true }
```

### Типы данных API

```
ProjectDetails {
  id:          string           // хэш от projectDir
  displayName: string           // "owner/repo issue-123"
  repoUrl:     string
  repoRef:     string
  status:      "running" | "stopped" | "unknown"
  statusLabel: string           // "running (2h ago)"
  sshPort:     u16
  projectDir:  string
  ports:       [{ host: u16, container: u16, protocol: "tcp" }]
}
```

---

## 8. Управление credentials

### Структура global.env

```bash
# ~/.docker-git/.orch/env/global.env
GH_TOKEN=ghp_xxxxxxxxxxxx
GIT_AUTH_DEFAULT=ghp_xxxxxxxxxxxx
GIT_AUTH_WORK=ghp_yyyyyyyyyyyy
CLAUDE_API_KEY=sk-ant-xxxx
ANTHROPIC_API_KEY=sk-ant-xxxx
```

### Правила:
1. Файл никогда не коммитится в git (только scrap с явным согласием)
2. Монтируется в контейнеры как **read-only**
3. Несколько токенов GitHub хранятся с метками (`--label work`)
4. Основной токен всегда дублируется в `GH_TOKEN` для совместимости

### Маскировка при выводе:
```
ghp_abcdef123456  →  ghp_ab****3456
```

---

## 9. Сетевые режимы

### Shared (по умолчанию)
```
Все контейнеры подключены к одной сети: docker-git-shared
Создаётся автоматически если не существует:
  docker network create docker-git-shared

Плюсы: меньше ресурсов, контейнеры видят друг друга
Минусы: нет изоляции между проектами
```

### Project (изолированный)
```
Для каждого проекта создаётся отдельная bridge-сеть: dg-{slug}-net

Плюсы: полная изоляция сети
Минусы: больше ресурсов, адресное пространство
```

---

## 10. Именование (детерминированные правила)

```
URL: https://github.com/owner/repo
  slug         = "owner-repo"
  containerName = "dg-owner-repo"
  serviceName   = "owner-repo"
  volumeName    = "dg-owner-repo-vol"
  networkName   = "dg-owner-repo-net"
  projectDir    = ~/.docker-git/owner/repo/

URL: https://github.com/owner/repo/issues/123
  slug         = "owner-repo-issue-123"
  containerName = "dg-owner-repo-issue-123"
  projectDir    = ~/.docker-git/owner/repo/issue-123/

URL: https://github.com/owner/repo/pull/456
  slug         = "owner-repo-pr-456"
  containerName = "dg-owner-repo-pr-456"
  projectDir    = ~/.docker-git/owner/repo/pr-456/
```

**Правила:**
- Только lowercase, буквы, цифры и дефисы
- Максимум 63 символа (ограничение Docker)
- `/` из URL → `-` в slug

---

## 11. Обработка ошибок

### Типы ошибок

```
ParseError
  UnknownCommand(command: string)
  InvalidOption(option: string, value: string, reason: string)
  MissingRequiredOption(option: string)

ProjectError
  AlreadyExists(projectDir: string)
  NotFound(projectDir: string)
  InvalidConfig(path: string, reason: string)

DockerError
  DaemonUnreachable
  CommandFailed(command: string, exitCode: i32, stderr: string)
  ContainerNotRunning(name: string)
  PortInUse(port: u16)

AuthError
  TokenInvalid(service: string)
  TokenNotFound(label: string)
  LoginFailed(service: string, reason: string)

GitError
  CloneFailed(url: string, reason: string)
  PushFailed(reason: string)
  InvalidRef(ref: string)

SshError
  ConnectionFailed(port: u16)
  KeyNotFound(path: string)
  Timeout(seconds: u32)
```

### Стратегии:
- Docker Hub / DNS ошибки при `compose up` → **retry 3 раза** с задержкой 5s
- SSH подключение при старте → **polling** каждые 1s, timeout 60s
- Все остальные ошибки → **fail fast** с понятным сообщением

---

## 12. Переменные окружения (конфигурация)

```
DOCKER_GIT_PROJECTS_ROOT      Корневая папка проектов
                               Default: ~/.docker-git

DOCKER_GIT_API_PORT           Порт HTTP API
                               Default: 3334

DOCKER_GIT_FEDERATION_PUBLIC_ORIGIN   Публичный URL для ActivityPub
                               Default: http://localhost:3334

DOCKER_GIT_OUTBOX_POLLING_INTERVAL_MS Интервал polling федерации
                               Default: 5000

CODEX_SHARE_AUTH              Шарить Codex auth между проектами
                               Default: 1

CLAUDE_AUTO_SYSTEM_PROMPT     Автоматически подключать system prompt
                               Default: 1
```

---

## 13. Инварианты системы

1. **Один проект = одна директория**: коллизий быть не может, т.к. пути детерминированы из URL
2. **Идемпотентность именования**: одинаковый URL всегда даёт одинаковые имена
3. **Изоляция credentials**: токены никогда не попадают в git, только монтируются как read-only volumes
4. **Shared cache безопасен**: один и тот же pnpm store используется всеми проектами (pnpm store content-addressed)
5. **Entrypoint идемпотентен**: повторный запуск контейнера не ломает состояние
6. **Port isolation**: SSH порт проверяется на доступность перед записью в конфиг
7. **Template пurity**: шаблоны — чистые функции, нет рандома, нет IO

---

## 14. Scope для реализации на Rust

### Обязательные компоненты

| Компонент | Rust crates |
|---|---|
| CLI парсер | `clap` |
| HTTP API | `axum` + `tokio` |
| Async runtime | `tokio` |
| Сериализация | `serde` + `serde_json` |
| Ошибки | `thiserror` + `anyhow` |
| Файловая система | `std::fs` + `tokio::fs` |
| Запуск процессов | `tokio::process` |
| TUI | `ratatui` + `crossterm` |
| HTTP клиент | `reqwest` |
| Шаблоны | встроенная генерация строк (format!) |

### Порядок реализации

1. **Типы данных** (domain.rs) — ProjectConfig, TemplateConfig, Command, все ошибки
2. **Генерация шаблонов** (templates/) — чистые функции, легко тестировать
3. **Файловая система** (fs.rs) — CRUD операций над ~/.docker-git/
4. **Docker wrapper** (docker.rs) — обёртка над `docker` и `docker compose` CLI
5. **CLI** (cli.rs) — парсинг через clap, маппинг в Command
6. **Бизнес-логика** (usecases/) — create, delete, status, auth, state, scrap
7. **SSH** (ssh.rs) — запуск SSH процесса, polling
8. **HTTP API** (api/) — axum роутер, SSE события
9. **TUI** (tui/) — ratatui компоненты для меню
10. **Federation** (federation/) — ActivityPub (опционально)

---

*Версия документа: 1.0 | Дата: 2026-03-09*
