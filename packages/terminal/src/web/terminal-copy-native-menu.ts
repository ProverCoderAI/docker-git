import type { TerminalCopyMouseEvent } from "./terminal-copy-selection-drag.js"

/**
 * Facade for xterm's hidden textarea used by native browser copy commands.
 *
 * @pure true - the type only describes the injected DOM shell boundary.
 * @effect none at declaration time; implementations perform focus/select/style/value DOM effects.
 * @invariant Style and value writes affect the same textarea that focus() and select() address.
 * @precondition Implementations are xterm-compatible textarea-like objects.
 * @postcondition Consumers can prepare selected text for the browser context-menu Copy command.
 * @complexity O(1)
 * @throws Never
 */
export type TerminalCopyTextarea = {
  readonly focus: () => void
  readonly select: () => void
  readonly style: {
    height: string
    left: string
    top: string
    width: string
    zIndex: string
  }
  value: string
}

/**
 * Minimal host facade for locating the terminal screen relative to context-menu coordinates.
 *
 * @pure true - the type only describes optional DOM lookup capabilities.
 * @effect none at declaration time; implementations may perform DOM layout reads when called.
 * @invariant querySelector(".xterm-screen") returns an element in the host coordinate space when available.
 * @precondition Host methods, when present, follow DOM getBoundingClientRect/querySelector contracts.
 * @postcondition Consumers can resolve the screen origin without depending on concrete browser classes.
 * @complexity O(1)
 * @throws Never
 */
type TerminalCopyScreenElement = {
  readonly getBoundingClientRect: () => {
    readonly left: number
    readonly top: number
  }
}

/**
 * Host facade used by the native copy menu preparation shell.
 *
 * @pure true - the type only describes injected DOM capabilities.
 * @effect none at declaration time; method implementations can read DOM layout.
 * @invariant At least one of host.getBoundingClientRect or host.querySelector(".xterm-screen") may define origin.
 * @precondition Optional methods preserve their `this` binding semantics when called through this facade.
 * @postcondition Consumers can choose the most precise terminal screen origin available.
 * @complexity O(1)
 * @throws Never
 */
export type TerminalNativeCopyMenuHost = {
  readonly getBoundingClientRect?: TerminalCopyScreenElement["getBoundingClientRect"]
  readonly querySelector?: (selector: string) => TerminalCopyScreenElement | null
}

type PrepareNativeBrowserCopyMenuArgs = {
  readonly event: TerminalCopyMouseEvent
  readonly host: TerminalNativeCopyMenuHost
  readonly selection: string
  readonly textarea: TerminalCopyTextarea | undefined
}

const terminalContextMenuTextareaOffsetPx = 10
const terminalContextMenuTextareaSizePx = 20
const xtermScreenSelector = ".xterm-screen"

/**
 * Normalizes optional event coordinates to the DOM origin default.
 *
 * @param value - Optional mouse coordinate from a browser-like event facade.
 * @returns The coordinate value or zero when the event omits it.
 * @pure true
 * @effect none
 * @invariant result = value when value is defined; otherwise result = 0.
 * @precondition value is either undefined or a finite event coordinate.
 * @postcondition The caller can use the result in textarea positioning arithmetic.
 * @complexity O(1)
 * @throws Never
 */
// CHANGE: normalize optional mouse coordinates for native copy textarea positioning
// WHY: synthetic test events and browser events can omit client coordinates
// QUOTE(ТЗ): n/a
// REF: PR-407-CodeRabbit-native-copy-menu-docs
// SOURCE: n/a
// FORMAT THEOREM: optionalNumber(x) = x if x is defined, otherwise 0
// PURITY: CORE
// EFFECT: none
// INVARIANT: result is always a number
// COMPLEXITY: O(1)/O(1)
const optionalNumber = (value: number | undefined): number => value ?? 0

/**
 * Adapts a host-level bounding box method into a screen element facade.
 *
 * @param host - Native copy menu host with an optional getBoundingClientRect method.
 * @returns A screen element facade when the host can provide its own rectangle; otherwise null.
 * @pure true - does not read layout until the returned facade is invoked.
 * @effect none during resolution; returned facade calls host.getBoundingClientRect().
 * @invariant Non-null result preserves host as the `this` value for getBoundingClientRect.
 * @precondition host is the DOM-like object that owns the optional getBoundingClientRect method.
 * @postcondition The caller can use the result as a fallback screen-origin provider.
 * @complexity O(1)
 * @throws Never
 */
// CHANGE: preserve host-bound layout reads when no .xterm-screen child is available
// WHY: the fallback must call getBoundingClientRect with the original DOM receiver
// QUOTE(ТЗ): n/a
// REF: PR-407-CodeRabbit-native-copy-menu-docs
// SOURCE: n/a
// FORMAT THEOREM: hasRect(host) => result.getBoundingClientRect() = host.getBoundingClientRect.call(host)
// PURITY: SHELL
// EFFECT: deferred host.getBoundingClientRect()
// INVARIANT: null is returned iff the host has no bounding-rect method
// COMPLEXITY: O(1)/O(1)
const resolveContextMenuHostScreenElement = (
  host: TerminalNativeCopyMenuHost
): TerminalCopyScreenElement | null => {
  const getBoundingClientRect = host.getBoundingClientRect
  if (getBoundingClientRect === undefined) {
    return null
  }
  return {
    getBoundingClientRect: () => getBoundingClientRect.call(host)
  }
}

/**
 * Resolves the preferred terminal screen origin for native copy menu positioning.
 *
 * @param host - Native copy menu host that may expose xterm screen lookup or host bounds.
 * @returns The xterm screen element when available, otherwise host bounds, otherwise null.
 * @pure true - delegates to injected DOM facades without mutating them.
 * @effect optional host.querySelector(".xterm-screen") and deferred getBoundingClientRect reads.
 * @invariant querySelector(".xterm-screen") takes precedence over host-level bounds.
 * @precondition host methods follow DOM-compatible contracts.
 * @postcondition Non-null result can provide coordinates for the helper textarea.
 * @complexity O(1)
 * @throws Never
 */
// CHANGE: prefer the xterm screen coordinate space for context-menu helper positioning
// WHY: textarea coordinates need to be relative to the terminal screen, not an arbitrary ancestor
// QUOTE(ТЗ): n/a
// REF: PR-407-CodeRabbit-native-copy-menu-docs
// SOURCE: n/a
// FORMAT THEOREM: screen(host) = querySelector(.xterm-screen) ?? hostBounds(host)
// PURITY: SHELL
// EFFECT: optional host.querySelector lookup
// INVARIANT: screen child lookup wins over host fallback
// COMPLEXITY: O(1)/O(1)
const resolveContextMenuScreenElement = (
  host: TerminalNativeCopyMenuHost
): TerminalCopyScreenElement | null =>
  host.querySelector?.(xtermScreenSelector) ?? resolveContextMenuHostScreenElement(host)

/**
 * Prepares xterm's hidden textarea so the native browser context-menu Copy item copies terminal text.
 *
 * @param args - Event coordinates, host lookup facade, cached selection text, and xterm textarea facade.
 * @returns True iff a non-empty selection was written into a resolved textarea and selected for copying.
 * @pure false - mutates the injected textarea and reads DOM layout through injected facades.
 * @effect textarea.style/value writes, textarea.focus(), textarea.select(), screen.getBoundingClientRect().
 * @invariant result => selection.length > 0 and textarea.value = selection.
 * @precondition event coordinates are in the same viewport space as getBoundingClientRect values.
 * @postcondition Success positions a small helper textarea near the context-menu event and selects its value.
 * @complexity O(n) where n = selection.length.
 * @throws Never under the injected facade contracts.
 */
// CHANGE: prepare xterm's hidden textarea before the browser context menu opens
// WHY: Chrome only shows and executes native Copy when a focused selected textarea value exists
// QUOTE(ТЗ): "А куда пропала кнопка copy?"
// REF: user-message-2026-06-15-native-copy-menu
// SOURCE: n/a
// FORMAT THEOREM: selection != "" and textarea and screen => prepared(textarea, selection)
// PURITY: SHELL
// EFFECT: DOM textarea style/value/focus/select and layout reads
// INVARIANT: false result leaves textarea unmodified by this function
// COMPLEXITY: O(n)/O(1)
export const prepareNativeBrowserCopyMenu = (
  { event, host, selection, textarea }: PrepareNativeBrowserCopyMenuArgs
): boolean => {
  const screenElement = resolveContextMenuScreenElement(host)
  if (selection.length === 0 || textarea === undefined || screenElement === null) {
    return false
  }
  const screenPosition = screenElement.getBoundingClientRect()
  textarea.style.width = `${terminalContextMenuTextareaSizePx}px`
  textarea.style.height = `${terminalContextMenuTextareaSizePx}px`
  textarea.style.left = `${optionalNumber(event.clientX) - screenPosition.left - terminalContextMenuTextareaOffsetPx}px`
  textarea.style.top = `${optionalNumber(event.clientY) - screenPosition.top - terminalContextMenuTextareaOffsetPx}px`
  textarea.style.zIndex = "1000"
  textarea.focus()
  textarea.value = selection
  textarea.select()
  return true
}

/**
 * Clears the helper textarea after the copy context is consumed or invalidated.
 *
 * @param textarea - Optional xterm helper textarea facade.
 * @pure false - mutates the injected textarea when present.
 * @effect textarea.value = "".
 * @invariant textarea === undefined => no effect; textarea !== undefined => textarea.value = "" after return.
 * @precondition textarea, when present, accepts value writes.
 * @postcondition No stale cached selection remains in the helper textarea.
 * @complexity O(1)
 * @throws Never under the injected facade contract.
 */
// CHANGE: clear native copy helper text when selection context is no longer active
// WHY: stale helper textarea contents must not be copied after selection invalidation
// QUOTE(ТЗ): n/a
// REF: PR-407-CodeRabbit-native-copy-menu-docs
// SOURCE: n/a
// FORMAT THEOREM: clear(textarea) => textarea.value = "" when textarea exists
// PURITY: SHELL
// EFFECT: textarea.value mutation
// INVARIANT: undefined textarea is a no-op
// COMPLEXITY: O(1)/O(1)
export const clearNativeBrowserCopyMenu = (
  textarea: TerminalCopyTextarea | undefined
): void => {
  if (textarea !== undefined) {
    textarea.value = ""
  }
}
