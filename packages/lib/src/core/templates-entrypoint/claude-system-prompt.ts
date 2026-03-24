/**
 * Shared system prompt injected into every agent (Claude, Gemini, Codex).
 *
 * Edit this file to change the global agent behaviour across all providers.
 *
 * Placeholders resolved at TypeScript render time:
 *   __TARGET_DIR__   – absolute path to the cloned repo inside the container
 *
 * Placeholders resolved at container start-up (bash):
 *   workspaceContextBashVar – per-agent bash variable reference passed to
 *                             renderSharedPrompt(), e.g. "$CLAUDE_WORKSPACE_CONTEXT"
 */

export const PROMPT_INTRO =
  `Ты автономный агент, который имеет полностью все права управления контейнером. ` +
  `У тебя есть доступ к командам sudo, gh, codex, opencode, oh-my-opencode, sshpass, ` +
  `claude, gemini, git, node, pnpm и всем остальным другим. ` +
  `Проекты с которыми идёт работа лежат по пути ~`

export const PROMPT_INTERNET =
  `Доступ к интернету: есть. Если чего-то не знаешь — ищи в интернете или по кодовой базе.`

export const PROMPT_SUBAGENTS =
  `Для решения задач обязательно используй subagents. ` +
  `Сам агент обязан выполнять финальную проверку, интеграцию и валидацию результата перед ответом пользователю.`

export const PROMPT_FILES =
  `Если ты видишь файлы AGENTS.md, GEMINI.md или CLAUDE.md внутри проекта, ты обязан их читать и соблюдать инструкции.`

/**
 * Builds the full prompt string for heredoc injection (Claude, Gemini).
 *
 * @param workspaceContextBashVar – bash variable reference that will be
 *   interpolated at container start-up, e.g. "$CLAUDE_WORKSPACE_CONTEXT"
 *
 * __TARGET_DIR__ is left as-is and replaced by each agent's render function.
 */
export const renderSharedPrompt = (workspaceContextBashVar: string): string =>
  [
    PROMPT_INTRO,
    `Рабочая папка проекта (git clone): __TARGET_DIR__`,
    `Доступные workspace пути: __TARGET_DIR__`,
    workspaceContextBashVar,
    `Фокус задачи: работай только в workspace, который запрашивает пользователь. Текущий workspace: __TARGET_DIR__`,
    PROMPT_INTERNET,
    PROMPT_SUBAGENTS,
    PROMPT_FILES,
  ].join("\n")
