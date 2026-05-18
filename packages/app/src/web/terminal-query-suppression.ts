export type TerminalQuerySuppression = { readonly dispose: () => void }

export type TerminalQuerySuppressionOptions = {
  readonly allowMouseTracking?: boolean
}

type Disposable = { readonly dispose: () => void }

type FunctionIdentifier = {
  readonly final: string
  readonly intermediates?: string
  readonly prefix?: string
}

type CsiParam = number | ReadonlyArray<number>

type CsiParams = ReadonlyArray<CsiParam>

export type TerminalQuerySuppressionTarget = {
  readonly parser: {
    readonly registerCsiHandler: (
      id: FunctionIdentifier,
      callback: (params: CsiParams) => boolean
    ) => Disposable
    readonly registerDcsHandler: (
      id: FunctionIdentifier,
      callback: (data: string, params: CsiParams) => boolean
    ) => Disposable
    readonly registerOscHandler: (
      ident: number,
      callback: (data: string) => boolean
    ) => Disposable
  }
}

// DEC private modes whose `h`/`l` setter can cause xterm.js to emit event bytes
// back through `onData` on later DOM events.
const MOUSE_TRACKING_PRIVATE_MODES: ReadonlySet<number> = new Set([
  1000,
  1002,
  1003,
  1006,
  1015,
  1016
])
const FOCUS_REPORTING_PRIVATE_MODE = 1004

// Suppressing SET leaves xterm.js in the default state (no event emission);
// suppressing RESET is harmless and kept for symmetry.
// Modes intentionally left to fall through to xterm's built-in handlers:
//   25   — cursor visibility
//   1049 — alternate screen buffer
//   2004 — bracketed paste
//   2026 — synchronized output (Ink uses BSU/ESU around every frame)
//   1007 — alternate scroll (only changes wheel semantics, no leak)
const SUPPRESSED_PRIVATE_MODES: ReadonlySet<number> = new Set([
  ...MOUSE_TRACKING_PRIVATE_MODES,
  FOCUS_REPORTING_PRIVATE_MODE
])

const isColorQuery = (data: string): boolean => {
  for (const segment of data.split(";")) {
    if (segment === "?") {
      return true
    }
  }
  return false
}

const extractParam = (param: CsiParam): number | null => {
  if (typeof param === "number") {
    return param
  }
  const head = param[0]
  return typeof head === "number" ? head : null
}

const shouldSuppressPrivateMode = (
  mode: number,
  options: TerminalQuerySuppressionOptions
): boolean =>
  mode === FOCUS_REPORTING_PRIVATE_MODE ||
  (options.allowMouseTracking !== true && MOUSE_TRACKING_PRIVATE_MODES.has(mode))

const containsSuppressedPrivateMode = (
  params: CsiParams,
  options: TerminalQuerySuppressionOptions
): boolean => {
  for (const param of params) {
    const value = extractParam(param)
    if (value !== null && shouldSuppressPrivateMode(value, options)) {
      return true
    }
  }
  return false
}

const registerOscColorQuerySuppressor = (
  terminal: TerminalQuerySuppressionTarget,
  identifier: number
): Disposable => terminal.parser.registerOscHandler(identifier, (data) => isColorQuery(data))

const registerCsiSuppressor = (
  terminal: TerminalQuerySuppressionTarget,
  identifier: FunctionIdentifier
): Disposable => terminal.parser.registerCsiHandler(identifier, () => true)

const registerDcsSuppressor = (
  terminal: TerminalQuerySuppressionTarget,
  identifier: FunctionIdentifier
): Disposable => terminal.parser.registerDcsHandler(identifier, () => true)

const registerSelectivePrivateModeSuppressor = (
  terminal: TerminalQuerySuppressionTarget,
  final: "h" | "l",
  options: TerminalQuerySuppressionOptions
): Disposable =>
  terminal.parser.registerCsiHandler(
    { final, prefix: "?" },
    (params) => containsSuppressedPrivateMode(params, options)
  )

export const installTerminalQuerySuppression = (
  terminal: TerminalQuerySuppressionTarget,
  options: TerminalQuerySuppressionOptions = {}
): TerminalQuerySuppression => {
  const disposables: ReadonlyArray<Disposable> = [
    // OSC 4/10/11/12 — color queries (`?` payload). Set-color payloads fall through.
    registerOscColorQuerySuppressor(terminal, 4),
    registerOscColorQuerySuppressor(terminal, 10),
    registerOscColorQuerySuppressor(terminal, 11),
    registerOscColorQuerySuppressor(terminal, 12),
    // CSI c / > c / = c — primary/secondary/tertiary device attributes (DA1/DA2/DA3).
    registerCsiSuppressor(terminal, { final: "c" }),
    registerCsiSuppressor(terminal, { final: "c", prefix: ">" }),
    registerCsiSuppressor(terminal, { final: "c", prefix: "=" }),
    // CSI n / ? n — device status report and cursor position report.
    registerCsiSuppressor(terminal, { final: "n" }),
    registerCsiSuppressor(terminal, { final: "n", prefix: "?" }),
    // CSI $ p / CSI ? $ p — DECRQM (ANSI and DEC private forms). xterm.js always
    // replies via `requestMode`, including for the `?2026 $p` synchronized-output
    // probe that Ink emits during startup.
    registerCsiSuppressor(terminal, { final: "p", intermediates: "$" }),
    registerCsiSuppressor(terminal, { final: "p", intermediates: "$", prefix: "?" }),
    // DCS $ q ... ST — DECRQSS. xterm.js always replies via `requestStatusString`.
    registerDcsSuppressor(terminal, { final: "q", intermediates: "$" }),
    // DCS + q ... ST — XTGETTCAP. No reply in 5.3.0; suppressed for defense-in-depth.
    registerDcsSuppressor(terminal, { final: "q", intermediates: "+" }),
    // CSI > q — XTVERSION. Not in 5.3.0 but auto-replies in xterm.js master.
    registerCsiSuppressor(terminal, { final: "q", prefix: ">" }),
    // CSI Pm t — window manipulation. Gated by `windowOptions` (off by default);
    // suppressed so an accidental future enable does not leak size reports.
    registerCsiSuppressor(terminal, { final: "t" }),
    // CSI ? h / CSI ? l — block xterm from enabling focus reporting and,
    // unless explicitly allowed for tmux project terminals, mouse tracking modes.
    // Other DEC private modes fall through to xterm's built-in setters.
    registerSelectivePrivateModeSuppressor(terminal, "h", options),
    registerSelectivePrivateModeSuppressor(terminal, "l", options)
  ]
  return {
    dispose: () => {
      for (const disposable of disposables) {
        disposable.dispose()
      }
    }
  }
}

export const isTerminalColorQuery = isColorQuery

export const isSuppressedDecPrivateMode = (mode: number): boolean => SUPPRESSED_PRIVATE_MODES.has(mode)
