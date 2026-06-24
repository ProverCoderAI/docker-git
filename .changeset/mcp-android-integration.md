---
"@prover-coder-ai/docker-git": minor
---

Add Android MCP integration alongside the existing Playwright MCP support (issue #436).

Projects can now opt into a nested Android emulator sidecar driven by the
first-party Rust `android-connection` MCP server, mirroring how Playwright MCP works. Enable it
with the new `--mcp-android` / `--no-mcp-android` create flags, the `mcp-android`
subcommand, the interactive create-flow prompt, or the `enableMcpAndroid` field
on the web/API create-project request. When enabled, the generated
`docker-compose.yml` adds a gated `docker-android` emulator service (KVM,
ADB port forwarding, headless CI mode) and the agent MCP config writers register
the Android server so it coexists with Playwright.
