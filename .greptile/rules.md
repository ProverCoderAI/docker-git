# SPEC-DRIVEN DEVELOPMENT Review Rules

Review every PR against its source of truth, not only against the diff.

Use README.md, repository Markdown docs, linked issues, PR description, PR comments/discussion, and the relevant codebase as review context.

Flag:
- Spec drift or contradiction with the issue/TZ/spec.
- Undocumented behavior changes.
- Missing tests for promised behavior.
- Security regressions.
- Weak formal invariants, preconditions, or postconditions.
- Game-theory incentive problems where users can profitably bypass intended rules.

If the spec is not visible, ask the author to copy the final requirements into the issue or PR description.
