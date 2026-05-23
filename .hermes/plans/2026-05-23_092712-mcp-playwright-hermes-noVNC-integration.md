# Plan: MCP Playwright Integration for Hermes Agent (with noVNC compatibility)

## Goal
Study existing MCP Playwright connection in the Codex/docker-git setup (as referenced in README.md and e2e scripts), then create a precise replication plan for the Hermes Agent. Ensure seamless integration with the project's noVNC browser infrastructure so that MCP tools (launch, navigate, screenshot, interact) can control or coexist with the noVNC-exposed Chromium instance. The end result should make Playwright MCP tools first-class in Hermes (prefixed mcp_playwright_*) while preserving the Functional Core / Imperative Shell invariants from AGENTS.md.

## Current Context / Assumptions
- From read-only inspection (search_files for mcp|playwright|novnc|browser):
  - README.md explicitly mentions `--mcp-playwright` flag that enables Playwright MCP + Chromium sidecar for browser automation.
  - package.json has e2e:browser-command script and docker-git browser targets.
  - docker-git clone command in README uses --mcp-playwright.
  - No direct "hermes-browser" module found in top-level search, but browser toolset, CDP, and noVNC references exist in config and e2e scripts.
  - Current ~/.hermes/config.yaml has no mcp_servers.playwright (or minimal from prior non-plan turns); native-mcp skill is available and documents exact YAML + hermes mcp add workflow.
  - Codex integration likely lives in autonomous-ai-agents/codex or related docker-git patches/scripts (e2e/browser-command.sh, scripts/skiller-apply-docker-git-patches.mjs).
  - noVNC is part of the browser sidecar (common pattern for remote VNC access to the Playwright-controlled browser).
- Assumptions: Codex uses stdio transport via npx mcp-playwright (or equivalent bin mcp-server-playwright) with specific args for noVNC compatibility (headless=false, user-data-dir, cdp-endpoint, storage-state). Hermes can reuse the same MCP server config + Layer wrapping. The existing browser toolset (CDP/Camofox) can be composed with MCP.
- Deep Research question simulated: "code that connects MCP Playwright to Codex/Hermes with noVNC" → patterns found in README + docker-git + native-mcp skill.

## Proposed Approach
- Reuse the exact MCP server definition from Codex/docker-git setup (npx -y mcp-playwright with flags for noVNC: --headless=false, --port for SSE, --user-data-dir shared with noVNC).
- Wrap via native-mcp client (config.yaml mcp_servers.playwright + hermes mcp add/test/configure).
- Create typed Effect Service Layer in CORE/SHELL boundary for mcp_playwright_* tools to maintain FCIS invariants.
- Add noVNC coordination (shared profile/storage-state, CDP endpoint sharing).
- Minimal diff: extend existing browser/e2e patterns rather than new from-scratch implementation.
- All changes follow AGENTS.md: pure CORE functions for config validation/invariants, SHELL for actual MCP connection, exhaustive Match, formal TSDoc with invariants, property-based tests.

## Step-by-Step Plan
1. **Inspection Phase (read-only)**: 
   - Read full README.md, docker-git related scripts (scripts/e2e/browser-command.sh, patches, docker-git/frontend-lib), packages/lib/src/core for existing browser/MCP patterns.
   - Read current ~/.hermes/config.yaml (mcp_servers, browser, terminal sections).
   - Search for Codex-specific MCP config (in autonomous-ai-agents/codex or kanban-codex-lane skills).
2. **Formalization**: Define invariants (e.g. ∀ browser_session: connected_to_noVNC ∧ mcp_tools_available → coordinated_state).
3. **Architecture**:
   - Add mcp_servers.playwright entry matching Codex (command + args for noVNC compatibility).
   - Create Shell Layer (PostgresMessageRepository-style) for MCP Playwright service.
   - Update tool registry to expose prefixed tools.
4. **noVNC Integration**: Ensure shared user-data-dir, CDP endpoint, or proxy so MCP controls the same browser instance exposed via noVNC.
5. **Implementation** (post-plan turn): Apply minimal diff to config + new core/shell modules.
6. **Verification**: Run hermes mcp test, e2e browser tests, architecture tests, property tests for invariants.

## Files Likely to Change
- .hermes/config.yaml (or via hermes mcp add) — add mcp_servers.playwright matching Codex pattern.
- packages/lib/src/core/domain.ts or new packages/lib/src/core/mcp-playwright.ts (types, invariants, pure validators).
- packages/lib/src/core/shell/mcp-layers.ts (Effect Layer for Playwright MCP service).
- README.md or AGENTS.md (update integration notes).
- scripts/e2e/browser-command.sh or new test script for noVNC + MCP coordination.
- packages/lib/tests/usecases/mcp-playwright-integration.test.ts (new).
- packages/lib/tests/architecture/fcis-boundary.test.ts (update to cover new MCP Layer).

## Tests / Validation
- **Property-based**: fc.assert on invariants (session shared between MCP and noVNC, no leaked effects in CORE).
- **Integration**: `hermes mcp test playwright`, e2e/browser-command.sh with --mcp-playwright flag, manual noVNC connection test.
- **Architecture**: lint + `npm test -- --grep="mcp|playwright|fcis|invariant"`, exhaustive pattern matching on tool results, no `any`/direct stdio in CORE.
- **Verification commands** (future turns):
  - `hermes mcp list && hermes mcp test playwright`
  - `npm run lint && npm test`
  - Grep for forbidden patterns in new core files.
  - Visual confirmation: noVNC shows the same browser controlled by MCP tools.

## Risks, Tradeoffs, and Open Questions
- **Risk**: noVNC and MCP both trying to control the same browser instance → race conditions or session corruption. Mitigation: shared storage-state + CDP proxy.
- **Tradeoff**: Reusing Codex/docker-git pattern minimizes diff but may inherit its quirks (0.0.1 package version, specific flags). Pure Hermes-native Layer is cleaner but larger change.
- **Open Questions**:
  - Exact args used in Codex/docker-git for noVNC (headless? port? allowed-origins? ) — needs deeper read of browser-command.sh and patches.
  - Does "Hermes Browser" exist as a distinct skill/Layer or is it the existing browser toolset + CDP?
  - How to formalize sampling (server-initiated LLM calls) from MCP Playwright in the Effect monad?
  - Impact on existing browser toolset (CDP vs MCP overlap) — should one deprecate the other?
- **Assumption to validate in step 1**: The `--mcp-playwright` in docker-git directly translates to a stdio MCP server config usable by Hermes native client.

## Mathematical Guarantees
- INVARIANT: ∀ session: (mcp_playwright_connected(session) ∧ noVNC_exposed(session)) → shared_user_data_dir(session) ∧ coordinated_cdp_endpoint(session)
- PRE: mcp package installed ∧ npx mcp-playwright available.
- POST: mcp_playwright_* tools registered and composable in Effect.gen() without breaking CORE purity.
- FORMAT THEOREM: ∀x ∈ BrowserSessions: connected_via_mcp(x) → controllable_via_novnc(x)

**REF**: Current conversation (MCP Playwright + noVNC request), native-mcp skill, AGENTS.md, README.md mentions of --mcp-playwright.
**SOURCE**: n/a (project inspection via read-only search_files + read_file).
**PURITY**: This plan document is pure (no effects).

Next turn (after this plan): Execute inspection steps with read-only tools, then implement per this plan.
