# Plan: Clean Built-in Hermes Browser + noVNC Integration (No MCP Duplication)

## Goal
Remove all MCP Playwright references and duplication, making the built-in Hermes browser toolset the only browser backend. Configure it to connect directly to the existing `dg-docker-git-issue-347-browser` container (and similar per-issue containers) via CDP, ensuring a single unified browser session that is also accessible via noVNC. This follows the user's preference for the platform's out-of-the-box solution without duplicate tools.

## Current Context / Assumptions
- From read-only inspection (search_files for cdp_url|noVNC|browser|playwright|mcp_servers):
  - `packages/lib/src/core/templates-entrypoint/hermes.ts` currently has MCP logic from previous changes.
  - `packages/api/src/services/project-browser.ts` handles CDP proxying (cdpUrl, cdpPath, renderExternalUrl) for browser containers.
  - Docker containers like `dg-docker-git-issue-347-browser` expose ports 5900 (VNC), 6080 (noVNC), 9223 (CDP).
  - Config has `browser.cdp_url` and `browser.engine = cdp` set to localhost:9223.
  - MCP was removed (`hermes mcp remove playwright`), no MCP servers or tools remain.
  - README and templates for codex/claude/gemini still reference MCP Playwright — these should be left alone or cleaned only for Hermes path to avoid breaking other agents.
- Assumption: The built-in browser tool can reliably use the CDP port of the per-issue browser container. noVNC is for viewing, CDP for control — single browser achieved via shared container.
- Deep Research question: "code that configures Hermes built-in browser with noVNC/CDP without MCP" → patterns in project-browser.ts, hermes.ts, and docker container names.

## Proposed Approach
- Extend/clean `hermes.ts` template to always configure `browser.cdp_url` and `browser.engine = cdp` pointing to the project's browser container (using the same logic as project-browser.ts).
- Remove any remaining MCP-related code from Hermes path (idempotent, no breaking changes to other agents).
- Add formal invariants for single-browser guarantee.
- No new files — minimal diff to existing template and tests.
- Make CDP configuration part of the Hermes entrypoint render so it's automatic when --mcp-playwright is not used (or always for Hermes).

## Step-by-Step Plan
1. Read-only inspection: re-read hermes.ts, project-browser.ts, current ~/.hermes/config.yaml, and docker ps output for exact container/CDP pattern.
2. Formalize invariants (single browser session, CDP connection succeeds, no MCP tools present).
3. Update `packages/lib/src/core/templates-entrypoint/hermes.ts`:
   - Add render function for CDP/noVNC configuration (mirroring project-browser.ts cdpUrl logic).
   - Remove any leftover MCP code.
   - Include formal TSDoc comment block.
4. Update related test: `packages/lib/tests/usecases/...` or architecture test for template rendering.
5. Verification: render the template, check generated bash contains correct cdp_url, run lint/test on the file, confirm no MCP in final config.

## Files Likely to Change
- `packages/lib/src/core/templates-entrypoint/hermes.ts` (main change — add CDP config render, remove MCP remnants).
- `packages/lib/tests/usecases/template-rendering.test.ts` or similar (update expected output for Hermes entrypoint).
- `packages/api/src/services/project-browser.ts` (if we need to expose more CDP helpers for Hermes — low probability).
- No changes to codex.ts, claude.ts, or MCP-related files (preserve other agents).

## Tests / Validation
- **Unit**: Test `renderEntrypointHermesConfig` produces bash with `browser.cdp_url=http://localhost:9223` and `engine=cdp`.
- **Integration**: Render full entrypoint, run in test container, verify `hermes tools list` shows only built-in browser (no mcp_playwright_*).
- **Architecture**: Confirm no MCP imports/references in Hermes path, single-browser invariant holds (`cdp_url` matches container's 9223 port).
- **Verification commands** (future turns, read-only where possible):
  - `hermes tools list | grep -E 'browser|mcp'`
  - `docker ps | grep browser`
  - `npm run lint -- packages/lib/src/core/templates-entrypoint/hermes.ts`
  - `npm test -- --grep="hermes|browser|cdp|template"`

## Risks, Tradeoffs, and Open Questions
- **Risk**: CDP connection to port 9223 may fail if the browser container is not running or port not exposed in current terminal context. Mitigation: fallback to local Chromium or explicit error in template.
- **Tradeoff**: Losing MCP's advanced Playwright features (trace, better file handling, parallel execution) for simplicity and no duplication. Built-in browser is "коробочное" but less powerful.
- **Open Questions**:
  - Exact CDP WebSocket URL for the Cloudflare noVNC tunnel (is it always localhost:9223 or does it need external proxy like in project-browser.ts?).
  - Should we add `--no-mcp` flag to docker-git for Hermes to make this default?
  - How to handle noVNC viewing vs control — does built-in browser tool expose a noVNC link automatically?
  - Impact on existing issue-347 Hermes support (need to update HERMES.md or docs?).
- Assumption to validate in step 1: The dg-*-browser container's CDP port is reliably available at localhost:9223 from the main container.

## Mathematical Guarantees
- INVARIANT: ∀ hermes_session: (browser_tool_used(session) ∧ no_mcp_tools(session)) → connected_to_same_container_via_cdp(session) ∧ visible_in_noVNC(session)
- PRE: docker container dg-*-browser running with port 9223 exposed.
- POST: No duplicate browser tools in `hermes tools list`; single source of truth for browser = built-in + CDP.

**REF**: Current conversation (duplication concern, noVNC, built-in preference), previous plan, project-browser.ts.
**SOURCE**: n/a (read-only inspection of codebase and docker ps).
**PURITY**: This plan is pure documentation.

Next turn (after this plan): Execute read-only inspection steps, then implement the template update per this plan with minimal diff, followed by verification.

Saved: .hermes/plans/2026-05-23_095118-clean-builtin-browser-noVNC-no-mcp.md