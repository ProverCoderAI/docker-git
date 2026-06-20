# Terminal query suppression experiment

## Issues addressed

- **#271** — raw `^[]10;rgb:f4f4/f7f7/fbfb^[\` and `^[[?1;2c` echoed into the
  Claude Code prompt area.
- **#273** — Claude Code TUI in the web terminal: input rendered on the wrong
  row ("asd" below the plan banner), plan-approval menu does not accept
  arrow keys, and `─` divider lines bleed through the typing area.

Both have the same root cause: xterm.js answers terminal capability probes
through `Terminal.onData`, and the web bridge forwards every `onData` byte
to the PTY as if the user had typed it. Claude Code (Ink) then renders
those reply bytes verbatim, scrambles its frame buffer, or misroutes
keystrokes through its input parser.

## Probes that leaked in xterm.js@5.3.0

All sources cite xterm.js@5.3.0 `src/common/InputHandler.ts`.

### Active leaks closed by #271

| Probe | Reply |
|---|---|
| `OSC 4;<n>;? ST`, `OSC 10;?`, `OSC 11;?`, `OSC 12;?` color queries | indexed/foreground/background/cursor color |
| `CSI c`, `CSI > c`, `CSI = c` device attributes (DA1/DA2/DA3) | `CSI ?...c` |
| `CSI n`, `CSI ? n` device status / cursor position report (DSR/CPR) | `CSI ...n` |

### Additional active leaks closed by this change (for #273)

| Probe | Source in xterm.js@5.3.0 | Reply |
|---|---|---|
| `CSI Pm $ p` — DECRQM ANSI form | `InputHandler.ts:267` (`requestMode`) | `CSI Ps;Pm$y` |
| `CSI ? Pm $ p` — DECRQM private form (includes Ink's `?2026$p` synchronized-output probe) | `InputHandler.ts:268` (`requestMode`) | `CSI ?Ps;Pm$y` |
| `DCS $ q ... ST` — DECRQSS | `InputHandler.ts:381` (`requestStatusString`) | `DCS P{0,1}$r... ST` |

### Indirect leaks (state-triggered output) closed by this change

| Mode | Reason | Symptom in #273 |
|---|---|---|
| `CSI ? 1004 h` (focus reporting) | every DOM focus/blur pumps `CSI I` / `CSI O` into the PTY | cursor jumps, "asd" rendered one row below the plan banner, plan-approval menu mis-decodes input |
| `CSI ? 1000 h` / `1002 h` / `1003 h` / `1006 h` / `1015 h` / `1016 h` (mouse tracking) | every mouse event pumps coordinate bytes into the PTY | Ink frame buffer corruption, e.g. `─` divider bleeds through typing line |

### Defense-in-depth (no leak today, prevents regressions)

| Probe | Notes |
|---|---|
| `CSI > q` — XTVERSION | not in 5.3.0; xterm.js master always replies `DCS > \| xterm.js(version) ST` |
| `CSI Pm t` — window manipulation | gated by `windowOptions` (off by default in our build); explicit suppressor prevents accidental future enable |
| `DCS + q ... ST` — XTGETTCAP | not registered in 5.3.0; cheap to pre-empt |

## Modes intentionally left to fall through

These DEC private modes are useful and must continue to reach xterm's
built-in `h`/`l` setters:

- `25` — cursor visibility
- `1007` — alternate scroll (changes wheel semantics; no reply)
- `1049` — alternate screen buffer (Claude Code does not use it today but
  other TUIs do)
- `2004` — bracketed paste (xterm.js wraps actual paste bytes; we want this)
- `2026` — synchronized output (Ink wraps every frame in BSU/ESU; xterm.js
  ≥5.3 batches the writes)

The selective `CSI ? h` / `CSI ? l` handler returns `true` (suppress) only
when one of the seven suppressed mouse/focus modes is in the parameter
list, and `false` (fall through) for every other parameter.

## Implementation

`packages/app/src/web/terminal-query-suppression.ts` registers handlers via
`Terminal.parser.registerOscHandler` / `registerCsiHandler` /
`registerDcsHandler` directly after constructing the `Terminal`. Each
returns a disposable; the install function aggregates them so callers can
roll back the registrations cleanly (used by the unit tests in
`packages/app/tests/docker-git/terminal-query-suppression.test.ts`).

The selective DEC-private-mode handler iterates the params list (handling
both flat `(number | number[])[]` shapes that xterm.js emits) and short-
circuits as soon as a suppressed mode number is found. Sub-parameters
(`number[]`) are reduced to their head, which matches DECSET/DECRST
semantics (sub-params on these modes are vendor-specific extensions).

## Manual reproduction (unchanged from #271 notes)

1. `bun run docker-git -- browser` and open the web terminal.
2. Run a TUI that probes capabilities, e.g. `claude` or
   `bash -c 'printf "\\033[?2026\$p"'` (synchronized-output DECRQM).
3. Without the fix, reply bytes leak into the prompt and the TUI either
   echoes them or mis-decodes them as keystrokes. With the fix, nothing
   leaks and Ink rendering stays stable across browser focus/blur.

## Verification

- `bun x vitest run tests/docker-git/terminal-query-suppression.test.ts`
  — 15/15 tests pass (color query detection, every probe identifier
  registered, all suppressed modes consumed, all benign DEC private modes
  pass through, disposal closes every handler).
- `bun run typecheck` — clean.
- `eslint src/web/terminal-query-suppression.ts tests/docker-git/terminal-query-suppression.test.ts`
  — 0 errors, 0 warnings.
- `eslint --config eslint.effect-ts-check.config.mjs ...` — clean on both
  files.
