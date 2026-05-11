# Terminal query suppression experiment

## Issue (GitHub #271)

The web terminal renders raw escape sequences such as
`^[]10;rgb:f4f4/f7f7/fbfb^[\` and `^[[?1;2c` inside Claude Code's
prompt area, which makes navigation and rendering look broken.

## Root cause

TUI applications (Claude Code, Ultraplan, etc.) probe the terminal with
queries like:

- `\x1b]10;?\x1b\\` – ask for the foreground color (OSC 10).
- `\x1b]11;?\x1b\\` – ask for the background color (OSC 11).
- `\x1b]12;?\x1b\\` – ask for the cursor color (OSC 12).
- `\x1b]4;<n>;?\x1b\\` – ask for an indexed palette color (OSC 4).
- `\x1b[c` – primary device attributes query (DA1).
- `\x1b[>c` – secondary device attributes (DA2).
- `\x1b[=c` – tertiary device attributes (DA3).
- `\x1b[6n` – cursor position report (CPR).

`xterm.js@5.3.0` responds to all of those out-of-the-box. Because the
web terminal is fronted by `xterm.js`, the responses are emitted via
`Terminal.onData` and we forward them to the host PTY as user input.
Claude Code receives these bytes as keystrokes inside its prompt loop
and renders them verbatim, which is exactly what the screenshot in the
issue shows.

## Fix

We install a small parser shim immediately after instantiating the
`Terminal` (see `terminal-query-suppression.ts`):

- For `OSC 4/10/11/12` we intercept the handler chain. If the payload
  contains a `?` segment (query), we return `true` to consume the
  sequence without invoking xterm's default handler that would
  otherwise reply. Plain "set color" payloads return `false` so the
  default handler still applies the requested theme change.
- For DA1/DA2/DA3 (`CSI ... c`) and CPR (`CSI ... n`) we always
  return `true` so xterm never reports back to the PTY. None of the
  features that depend on those responses are useful for our headless
  web frontend.

The handlers are returned as disposables so callers (and the unit
tests) can roll the registration back without touching `xterm`'s
internal parser state.

## Manual reproduction notes

1. Start the web build (`bun run docker-git -- browser`) and open the
   web terminal.
2. Inside the container run a TUI that probes color (for example
   `bash -c 'printf "\\033]10;?\\033\\\\"'`).
3. Without the fix the printed escape sequence is echoed back into the
   prompt as garbage. With the fix nothing is echoed.
