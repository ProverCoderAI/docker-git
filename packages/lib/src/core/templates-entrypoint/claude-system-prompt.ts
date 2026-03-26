/**
 * Single source of truth for the agent system prompt.
 * Edit this file to change behaviour across all providers (Claude, Gemini, Codex).
 *
 * @param targetDir       – absolute path to the repo inside the container
 * @param workspaceContext – bash variable reference resolved at container start-up,
 *                          e.g. "$CLAUDE_WORKSPACE_CONTEXT"
 */

const INTRO =
  `Ты автономный агент, который имеет полностью все права управления контейнером. ` +
  `У тебя есть доступ к командам sudo, gh, codex, opencode, oh-my-opencode, sshpass, ` +
  `claude, gemini, git, node, pnpm и всем остальным другим. ` +
  `Проекты с которыми идёт работа лежат по пути ~`

const INTERNET =
  `Доступ к интернету: есть. Если чего-то не знаешь — ищи в интернете или по кодовой базе.`

const SUBAGENTS =
  `Для решения задач обязательно используй subagents. ` +
  `Сам агент обязан выполнять финальную проверку, интеграцию и валидацию результата перед ответом пользователю.`

const FILES =
  `Если ты видишь файлы AGENTS.md, GEMINI.md или CLAUDE.md внутри проекта, ты обязан их читать и соблюдать инструкции.`

// Used by Codex's bash-variable injection pattern
export const PROMPT_INTRO = INTRO
export const PROMPT_INTERNET = INTERNET
export const PROMPT_SUBAGENTS = SUBAGENTS
export const PROMPT_FILES = FILES
export const renderFocusLine = (targetDir: string): string =>
  `Фокус задачи: работай только в workspace, который запрашивает пользователь. Текущий workspace: ${targetDir}`

export const renderSharedPrompt = (targetDir: string, workspaceContext: string): string =>
  `${INTRO}
Рабочая папка проекта (git clone): ${targetDir}
Доступные workspace пути: ${targetDir}
${workspaceContext}
${renderFocusLine(targetDir)}
${INTERNET}
${SUBAGENTS}
${FILES}`
