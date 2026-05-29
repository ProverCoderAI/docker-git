# Plan: Rust-only noVNC + Browser Connection Module (Delete TS Version, Possible Separate Repo, Integrate into docker-git)

## Goal
Delete all TypeScript versions of the browser/noVNC connection (including the previous packages/browser-connection and lib/core version), keep only the Rust implementation in packages/rust-browser-connection (or move to separate repository), and update docker-git to use the Rust module/binary instead of the old MCP Playright + shell scripts. This eliminates duplication, makes the toolkit "из коробки" for both MCP-like and Hermes built-in browser tools, and follows issue #347.

## Current Context / Assumptions
- From read-only inspection (date, search_files for browser-connection|rust|novnc|mcp|playwright|cdp_url|dg-.*-browser, read_file for Cargo.toml, lib.rs, hermes.ts, project-browser.ts, pnpm-workspace.yaml, gh issue view 347):
  - Rust package `packages/rust-browser-connection` exists with BrowserConnection (bollard for Docker, ports 5900/6080/9223, URLs, invariant).
  - TS versions exist in packages/browser-connection (previous) and packages/lib/src/core/browser-connection.ts (duplicate).
  - docker-git uses MCP Playright in templates-entrypoint (codex.ts, claude.ts, hermes.ts), project-browser.ts for CDP/noVNC proxy, docker-git-session-sync style.
  - Issue #347 specifically asks to extract noVNC + MCP Playright into a single module for single browser with agent.
  - Current docker containers (dg-docker-git-issue-347-browser) expose the ports.
- Assumption: Rust binary can be called from TS entrypoints or docker images can include the Rust binary. Separate repo is feasible if maintenance is easier (as user suggested).
- Deep Research question simulated: "code that extracts noVNC + browser connection to Rust module without duplication" → patterns in rust-browser-connection, project-browser-core.ts, templates-entrypoint, and the rust-ai-driven-development-pipeline-template.

## Proposed Approach
- Delete all TS versions and references to avoid duplication.
- Keep/enhance the Rust package as the single source of truth (or move to separate repo like link-foundation style).
- Update docker-git to call the Rust binary (or link the crate) for browser start, noVNC/CDP URLs, single session management — replacing old MCP/shell logic.
- Make it "из коробки": the Rust module provides CLI and library, docker-git templates automatically use it when Hermes or other agents are selected.
- Follow AGENTS.md for the Rust part (formal comments in code, invariants, tests, verification).

## Step-by-step Plan
1. Read-only inspection: full read of rust-browser-connection/Cargo.toml, src/lib.rs, src/main.rs, all templates-entrypoint/* .ts that mention MCP/playwright/browser, project-browser.ts, pnpm-workspace.yaml, gh issue view 347 for exact requirements, docker ps for current browser containers.
2. Formalize: define invariants for single browser (one container, shared CDP/noVNC), types for URLs/ports, error handling.
3. Delete TS version: plan removal of packages/browser-connection, packages/lib/src/core/browser-connection.ts, references in pnpm-workspace.yaml, hermes.ts, project-browser.ts, templates.
4. Enhance Rust module: ensure it fully replicates docker-git MCP Playright behavior (start container with ports, return noVNC/CDP URLs, invariant check).
5. Integration into docker-git: update entrypoints to call Rust binary (e.g. `docker-git-browser-connection start --project $(project_id)`), update docker compose to include Rust binary if needed.
6. If separate repo: plan creating new repo, publishing the crate, updating docker-git to depend on it via cargo or binary download.
7. Verification: cargo test, cargo check, test docker-git with Rust module, confirm no MCP/TS duplication, single noVNC browser works, lint/typecheck.

## Files Likely to Change
- Delete: packages/browser-connection/ (entire TS package), packages/lib/src/core/browser-connection.ts, references in pnpm-workspace.yaml.
- Update: packages/lib/src/core/templates-entrypoint/hermes.ts (remove MCP, call Rust binary), packages/api/src/services/project-browser.ts (use Rust module for CDP/noVNC), packages/app/src/lib/core/templates-entrypoint/* (codex.ts, claude.ts if affected), docker-compose files or entrypoint scripts.
- Rust package: packages/rust-browser-connection/src/lib.rs, Cargo.toml (add more features if needed for full docker-git compatibility).
- Tests: packages/rust-browser-connection/tests/*, packages/lib/tests/usecases/browser-connection.test.ts (new for Rust integration).
- Docs: README.md, issue #347 (close it), AGENTS.md (update for Rust module).

## Tests / Validation
- **Rust**: `cargo test`, `cargo check`, unit tests for isSingleBrowserSession, integration with mock Docker.
- **docker-git**: Test with `docker-git clone <issue> --mcp-playwright` (should use Rust instead of old MCP), verify noVNC URL works, CDP port 9223 accessible, single container.
- **Verification steps**:
  - `cargo test` in rust-browser-connection.
  - `hermes tools list` (no MCP, only built-in browser).
  - `docker ps | grep browser` (single dg-*-browser container).
  - `npm run lint && npm test` in root (no TS duplication errors).
  - Manual test: open noVNC URL and use Hermes browser tool — same session.
- Run in CI with the new Rust binary included in docker images.

## Risks, Tradeoffs, and Open Questions
- **Risk**: Removing TS version breaks existing users or MCP-dependent code in codex/claude templates. Mitigation: keep backward compatibility in templates or deprecate MCP path.
- **Tradeoff**: Rust is faster and more reliable for Docker/container management, but adds Rust toolchain to the dev setup (vs pure TS "из коробки"). Separate repo adds maintenance but cleaner separation.
- **Open Questions**:
  - Separate repo or keep in monorepo? (user suggested separate — plan both options).
  - How to package the Rust binary in docker-git images (static binary or cargo install)?
  - Should the Rust module also handle MCP server registration or only the browser container/noVNC part?
  - Exact mapping of old MCP Playright flags to Rust CLI args.
  - CI/CD for Rust crate publishing and docker-git integration tests.
- Assumption to validate in step 1: The Rust binary can fully replace the old shell/MCP logic without breaking noVNC viewing or agent control.

## Mathematical Guarantees
- INVARIANT: ∀ projectId: start_browser(projectId) → single_container(dg-{projectId}-browser) ∧ cdp_url(projectId) = "http://localhost:9223" ∧ no_vnc_url(projectId) matches template ∧ isSingleBrowserSession(cdp, novnc) = true
- PRE: Docker daemon available, image dg-docker-git-browser available.
- POST: No TS/MCP duplication, only Rust module used in docker-git and Hermes.

**REF**: Current conversation + issue #347.
**SOURCE**: n/a (read-only inspection of codebase, gh issue view, docker ps).
**PURITY**: This plan is pure (no execution, only planning).

Next turn (after this plan): Execute read-only inspection steps (gh issue view, read_file for key files, search_files for references), then delete TS version, enhance Rust package, integrate into docker-git per this plan (with verification).

Saved to .hermes/plans/2026-05-23_102144-rust-only-noVNC-browser-module-separate-repo.md