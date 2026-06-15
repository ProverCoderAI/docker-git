import type { ActiveTerminalSession } from "./terminal.js"

// CHANGE: Treat sessions carrying a browser project id as tmux-backed project terminals.
// WHY: Project terminals run inside tmux, which both drives mouse tracking and switches
//      xterm into the alternate screen; auth/login terminals stay conservative.
// REF: issue-404 terminal cannot scroll.
// PURITY: CORE
// COMPLEXITY: O(1)/O(1)
export const isProjectTerminalSession = (session: ActiveTerminalSession): boolean =>
  session.browserProjectId !== undefined

/**
 * Whether xterm should allow DEC private mouse tracking modes for a session.
 *
 * @pure true
 * @complexity O(1)
 */
export const shouldAllowTerminalMouseTracking = (session: ActiveTerminalSession): boolean =>
  isProjectTerminalSession(session)

/**
 * Whether xterm should suppress the alternate screen (DEC 47/1047/1049) for a session.
 *
 * Project terminals run inside tmux: with the alternate screen active xterm keeps no
 * scrollback, so the terminal "constantly clears all text and only shows one page" and
 * wheel scrolling has nothing to scroll. Suppressing it keeps tmux/TUI output in xterm's
 * normal buffer where it accumulates in the 50k-line scrollback.
 *
 * @pure true
 * @complexity O(1)
 */
// REF: issue-404 terminal cannot scroll.
export const shouldSuppressTerminalAlternateScreen = (session: ActiveTerminalSession): boolean =>
  isProjectTerminalSession(session)
