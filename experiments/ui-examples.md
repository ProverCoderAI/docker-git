# Container UI examples (issue #237)

These are the rendered files that the user sees inside a running container after
the entrypoint executes. The new `*_SYSTEM_PROMPT_OVERRIDE` and
`*_SYSTEM_PROMPT_OVERRIDE_FILE` env vars (plus `CODEX_EXTRA_SKILLS_PATHS`) let
operators replace the body of any of these files without forking the templates.

---

## 1. Default behaviour (no overrides set)

Container env: `CLAUDE_AUTO_SYSTEM_PROMPT=1` (default), no override vars.

### `~/.claude/CLAUDE.md`

```markdown
<!-- docker-git-managed:claude-md -->
Ты автономный агент, который имеет полностью все права управления контейнером. У тебя есть доступ к командам sudo, gh, bun, codex, opencode, oh-my-opencode, sshpass, claude, git, node и всем остальным другим. Проекты с которыми идёт работа лежат по пути ~
Рабочая папка проекта (git clone): /home/dev/workspaces/ProverCoderAI/docker-git/issue-237
Доступные workspace пути: /home/dev/workspaces/ProverCoderAI/docker-git/issue-237
Контекст workspace: issue #237 (https://github.com/ProverCoderAI/docker-git/issues/237)
Фокус задачи: работай только в workspace, который запрашивает пользователь. Текущий workspace: /home/dev/workspaces/ProverCoderAI/docker-git/issue-237
Доступ к интернету: есть. Если чего-то не знаешь — ищи в интернете или по кодовой базе.
Для решения задач обязательно используй subagents. Сам агент обязан выполнять финальную проверку, интеграцию и валидацию результата перед ответом пользователю.
Если ты видишь файлы AGENTS.md или CLAUDE.md внутри проекта, ты обязан их читать и соблюдать инструкции.
<!-- /docker-git-managed:claude-md -->
```

### `~/.codex/AGENTS.md`

```markdown
Ты автономный агент, который имеет полностью все права управления контейнером. У тебя есть доступ к командам sudo, gh, bun, codex, opencode, oh-my-opencode, sshpass, git, node и всем остальным другим. Проекты с которыми идёт работа лежат по пути ~
<!-- docker-git:managed:start -->
Рабочая папка проекта (git clone): /home/dev/workspaces/ProverCoderAI/docker-git/issue-237
Доступные workspace пути: /home/dev/workspaces/ProverCoderAI/docker-git/issue-237
Контекст workspace: issue #237 (https://github.com/ProverCoderAI/docker-git/issues/237)
Фокус задачи: работай только в workspace, который запрашивает пользователь. Текущий workspace: /home/dev/workspaces/ProverCoderAI/docker-git/issue-237
Доступ к интернету: есть. Если чего-то не знаешь — ищи в интернете или по кодовой базе.
Для решения задач обязательно используй subagents. Сам агент обязан выполнять финальную проверку, интеграцию и валидацию результата перед ответом пользователю.
<!-- docker-git:managed:end -->
Если ты видишь файлы AGENTS.md внутри проекта, ты обязан их читать и соблюдать инструкции.
```

### `~/.gemini/GEMINI.md`

```markdown
<!-- docker-git-managed:gemini-md -->
Ты автономный агент Gemini, у тебя есть доступ к sudo, gh, gemini-cli, bun, git, node и всем остальным. Проекты с которыми идёт работа лежат по пути ~
Рабочая папка проекта (git clone): /home/dev/workspaces/ProverCoderAI/docker-git/issue-237
Доступные workspace пути: /home/dev/workspaces/ProverCoderAI/docker-git/issue-237
Контекст workspace: issue #237 (https://github.com/ProverCoderAI/docker-git/issues/237)
Фокус задачи: работай только в workspace, который запрашивает пользователь. Текущий workspace: /home/dev/workspaces/ProverCoderAI/docker-git/issue-237
Доступ к интернету: есть. Если чего-то не знаешь — ищи в интернете или по кодовой базе.
Для решения задач обязательно используй subagents. Сам агент обязан выполнять финальную проверку, интеграцию и валидацию результата перед ответом пользователю.
<!-- /docker-git-managed:gemini-md -->
```

### `ls ~/.codex/skills/.docker-git-project/` (no extra skills)

```
20-agents-skills -> /home/dev/workspaces/ProverCoderAI/docker-git/issue-237/.agents/skills
```

---

## 2. Inline override via `CLAUDE_SYSTEM_PROMPT_OVERRIDE`

Container env (in `.orch/env/project.env`):

```bash
CLAUDE_SYSTEM_PROMPT_OVERRIDE="You are a senior reviewer. Be terse. Only modify files in /home/dev/workspaces/ProverCoderAI/docker-git/issue-237."
```

### `~/.claude/CLAUDE.md`

```markdown
<!-- docker-git-managed:claude-md -->
You are a senior reviewer. Be terse. Only modify files in /home/dev/workspaces/ProverCoderAI/docker-git/issue-237.
<!-- /docker-git-managed:claude-md -->
```

The managed-block markers are preserved, so the next container restart still
detects the file as docker-git-managed and refreshes it idempotently.

---

## 3. File override via `CODEX_SYSTEM_PROMPT_OVERRIDE_FILE`

```bash
# .orch/env/project.env
CODEX_SYSTEM_PROMPT_OVERRIDE_FILE=/home/dev/.docker-git/prompts/codex.txt
```

```bash
# /home/dev/.docker-git/prompts/codex.txt
You are running inside docker-git. Workspace: /home/dev/workspaces/ProverCoderAI/docker-git/issue-237.
Always start by running `git status` and `gh issue view 237`.
```

### `~/.codex/AGENTS.md` (managed lines replaced)

```markdown
Ты автономный агент, который имеет полностью все права управления контейнером. У тебя есть доступ к командам sudo, gh, bun, codex, opencode, oh-my-opencode, sshpass, git, node и всем остальным другим. Проекты с которыми идёт работа лежат по пути ~
<!-- docker-git:managed:start -->
You are running inside docker-git. Workspace: /home/dev/workspaces/ProverCoderAI/docker-git/issue-237.
Always start by running `git status` and `gh issue view 237`.
<!-- docker-git:managed:end -->
Если ты видишь файлы AGENTS.md внутри проекта, ты обязан их читать и соблюдать инструкции.
```

`*_OVERRIDE_FILE` always wins over `*_OVERRIDE`. If neither is set, the default
content above is used.

---

## 4. Extra skills via `CODEX_EXTRA_SKILLS_PATHS`

```bash
# .orch/env/project.env
CODEX_EXTRA_SKILLS_PATHS="50-team-skills::team/skills,60-shared-rituals::infra/codex/rituals"
```

Project layout:

```
/home/dev/workspaces/ProverCoderAI/docker-git/issue-237/
├── .agents/skills/...
├── team/skills/...
└── infra/codex/rituals/...
```

### `ls ~/.codex/skills/.docker-git-project/` (extras now mounted)

```
20-agents-skills   -> /home/dev/workspaces/ProverCoderAI/docker-git/issue-237/.agents/skills
50-team-skills     -> /home/dev/workspaces/ProverCoderAI/docker-git/issue-237/team/skills
60-shared-rituals  -> /home/dev/workspaces/ProverCoderAI/docker-git/issue-237/infra/codex/rituals
```

The built-in priority list (`.skills`, `.agents/skills`, `.agents/.skills`,
`.codex/skills`, `.codex/.skills`) is preserved. Extras are appended only when
the relative path exists, so misconfigured entries are silently ignored.

---

## 5. Container terminal session showing the override hooks

```text
dev@dg-docker-git:~$ cat ~/.codex/AGENTS.md | head -3
Ты автономный агент, который имеет полностью все права управления контейнером...
<!-- docker-git:managed:start -->
You are running inside docker-git. Workspace: /home/dev/workspaces/ProverCoderAI/docker-git/issue-237.

dev@dg-docker-git:~$ ls -l ~/.codex/skills/.docker-git-project/
total 0
lrwxrwxrwx 1 dev dev 65 May  5 12:30 20-agents-skills -> /home/dev/workspaces/ProverCoderAI/docker-git/issue-237/.agents/skills
lrwxrwxrwx 1 dev dev 60 May  5 12:30 50-team-skills -> /home/dev/workspaces/ProverCoderAI/docker-git/issue-237/team/skills
lrwxrwxrwx 1 dev dev 64 May  5 12:30 60-shared-rituals -> /home/dev/workspaces/ProverCoderAI/docker-git/issue-237/infra/codex/rituals

dev@dg-docker-git:~$ env | grep -E '_(SYSTEM_PROMPT_OVERRIDE|EXTRA_SKILLS)'
CLAUDE_SYSTEM_PROMPT_OVERRIDE_FILE=/home/dev/.docker-git/prompts/claude.txt
CODEX_SYSTEM_PROMPT_OVERRIDE_FILE=/home/dev/.docker-git/prompts/codex.txt
GEMINI_SYSTEM_PROMPT_OVERRIDE=You are running inside docker-git...
CODEX_EXTRA_SKILLS_PATHS=50-team-skills::team/skills,60-shared-rituals::infra/codex/rituals
```
