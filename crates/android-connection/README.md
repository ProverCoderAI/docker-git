# docker-git Android connection

First-party Android MCP module for docker-git.

The crate provides two binaries:

- `android-connection`: MCP stdio server used by Codex, Claude, Gemini, and Grok.
- `docker-git-android-connection`: lifecycle CLI for deterministic Android runtime naming and Docker command construction.

The core module keeps deterministic naming, endpoint validation, and tool specifications pure. Shell effects are isolated in the binaries and MCP tool handlers.
