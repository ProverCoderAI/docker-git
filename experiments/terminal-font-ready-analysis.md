# Terminal rendering bugs investigation — issue #273

## Symptoms reported

Screenshots gathered from the issue and follow-up comments (saved under
`experiments/screenshots/`):

| File | Visible defect |
| --- | --- |
| `image1-slider.png` | Typed text (`asd`) appears below the prompt bar instead of inside it; the input slider falls outside the visible row. |
| `image2-plan.png` | Claude Code plan dialog (`Yes, and bypass permissions / manually approve / refine / Tell Claude what to change`) is visible but key presses do not select an option. |
| `image3-strike.png` | A line of typed text (`больше уязвимостей в коде нету?`) renders with a horizontal stroke crossing every character cell. |
| `image4-system-bug.png` | Chrome devtools issue panel reports "A form field element should have an id or name attribute" twice. |

All four are observed in the web terminal that hosts the Claude Code TUI
(see `packages/app/src/web/terminal-panel-runtime-core.ts`).

## Root cause

xterm.js measures the character cell once when `terminal.open(host)` is
called and again whenever `FitAddon.fit()` runs. The measurement is taken
from a canvas `measureText` call using the configured `fontFamily`.

`packages/app/src/web/terminal-panel-runtime-core.ts:79` configures
`fontFamily: "'IBM Plex Mono', 'SFMono-Regular', monospace"`. `IBM Plex
Mono` is loaded asynchronously from Google Fonts in
`packages/app/index.html:9-12`:

```html
<link
  href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Space+Grotesk:wght@500;700&display=swap"
  rel="stylesheet"
/>
```

`display=swap` means the browser paints the fallback (`SFMono-Regular` or
generic `monospace`) until the webfont arrives. xterm.js initialises
before the swap, caches the fallback metrics, and never rechecks them. As
soon as `IBM Plex Mono` is applied the on-screen glyphs grow/shrink
relative to the cell grid, which is what produces:

* the cursor/prompt offset in `image1-slider.png`;
* the apparent strikethrough in `image3-strike.png` — every cell paints a
  background underline/strikethrough decoration on its baseline, but the
  glyphs from the new font are rendered at a different vertical offset,
  so the decoration cuts through the middle of the characters;
* the unclickable plan options in `image2-plan.png` — xterm.js maps the
  pointer to the wrong text cell because the cached cell width no longer
  matches the painted width, so the buttons (`1/2/3/4` rows rendered by
  the TUI) never receive focus when clicked.

`image4-system-bug.png` is unrelated to fonts: the "Show system" toggle
in `packages/app/src/web/panel-tasks.tsx:54` declares an `<input
type="checkbox">` without `id`/`name`, and Chrome's Issues panel flags
two such elements.

## Fix outline

1. Resolve `IBM Plex Mono` from `document.fonts.ready` (and explicit
   `document.fonts.load(...)` requests) before mounting the xterm.js
   instance. While the font is still loading, keep the host hidden so
   that the canvas measurement is taken with the final font metrics.
2. After mount, re-run `fitAddon.fit()` whenever `document.fonts` reports
   that the relevant face has loaded, to handle slow networks.
3. Provide an `id` and `name` on the checkbox so Chrome stops flagging
   it.

## Verification

* `terminal-font-readiness.test.ts` exercises the new helper with mock
  `FontFaceSet` implementations covering the happy path, the timeout
  path, and the environment without `document.fonts` support.
* Manual: run `bun run --cwd packages/app dev:web`, throttle network to
  "Slow 3G" in devtools, and confirm the terminal stays empty until the
  webfont arrives, then renders without strikethrough artifacts.
