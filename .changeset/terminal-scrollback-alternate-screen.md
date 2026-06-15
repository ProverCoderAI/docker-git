---
"@prover-coder-ai/docker-git-terminal": patch
---

Fix project terminals clearing all output and showing only one page (no scroll).

Project terminals run inside tmux, which switches xterm into the alternate
screen buffer (DEC private modes 47/1047/1049). The alternate screen keeps no
scrollback, so output was wiped on every repaint and wheel scrolling had nothing
to reveal. Project terminals now suppress the alternate screen so tmux/TUI output
stays in xterm's normal buffer and accumulates in the 50k-line scrollback.
