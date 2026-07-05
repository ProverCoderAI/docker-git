---
"@prover-coder-ai/docker-git-terminal": patch
---

Stop rendering "unavailable" placeholder boxes for inline image paths that
cannot be fetched, and render each image preview at most once per terminal
session.

Failed image fetches previously produced an "unavailable" placeholder plus
four spacer rows, and every re-mention or redraw of the same path rendered
another preview. Unavailable paths are now skipped entirely (the clickable
path link remains), rendered paths are tracked per session so duplicates are
suppressed, and the leading line break before previews is written lazily so
fully skipped segments leave the terminal output untouched.
