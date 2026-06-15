# @prover-coder-ai/docker-git-terminal

## 0.1.1

### Patch Changes

- [#405](https://github.com/ProverCoderAI/docker-git/pull/405) [`77b8694`](https://github.com/ProverCoderAI/docker-git/commit/77b8694d73fdf8383d5089f42dc33e131d69d2b2) Thanks [@konard](https://github.com/konard)! - Fix project terminals clearing all output and showing only one page (no scroll).

  Project terminals run inside tmux, which switches xterm into the alternate
  screen buffer (DEC private modes 47/1047/1049). The alternate screen keeps no
  scrollback, so output was wiped on every repaint and wheel scrolling had nothing
  to reveal. Project terminals now suppress the alternate screen so tmux/TUI output
  stays in xterm's normal buffer and accumulates in the 50k-line scrollback.
