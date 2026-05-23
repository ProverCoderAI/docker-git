# Case Study: Issue #52 - Track Parity for browser-commander Preview-Regeneration Pattern

## Summary

Issue [#52](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/52) is a **tracking placeholder**, not a code change. The primary host for the pattern is [`link-foundation/js-ai-driven-development-pipeline-template#62`](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/62). The original real-world implementation lives in [`konard/vk-bot-desktop#52`](https://github.com/konard/vk-bot-desktop/pull/52), which closed [`konard/vk-bot-desktop#51`](https://github.com/konard/vk-bot-desktop/issues/51).

The pattern automates preview-image regeneration (README screenshots, the Pages site, and the `og:image`) at release time using [`browser-commander`](https://www.npmjs.com/package/browser-commander) and Playwright, then commits the drift back to `main` with `[skip ci]`. This Rust template currently ships no example-app surface that would render those screenshots, so the pattern cannot be applied here today. This case study captures the recipe so that the **next** PR that adds an example-app surface (a renderer, a Pages site with screenshots, or anything visual) can adopt the recipe verbatim instead of re-discovering it.

## Why this is a tracking issue, not an implementation

The upstream survey ([`docs/case-studies/issue-51/data/templates/survey.md`](https://github.com/konard/vk-bot-desktop/blob/issue-51-60ec0489f01f/docs/case-studies/issue-51/data/templates/survey.md) in `vk-bot-desktop`) confirmed that none of the four `link-foundation` AI-driven-development-pipeline-template repos ship browser automation or screenshot tooling. For this Rust template specifically:

- There is no example-app frontend surface in `src/`, `examples/`, or `docs/`.
- The Pages site deployed by `deploy-docs` is `cargo doc` output, which is not screenshot-driven.
- The `og:image` referenced from `README.md` is a static image, not a generated artifact.
- The `scripts/` directory is Rust-script-based (`rust-script`), with no Node.js toolchain wired in.

Because there is nothing to screenshot, adding a `preview-regen` job today would either run against an empty surface or hard-code fake fixtures. Either choice would drift from the upstream recipe rather than mirror it. The right move is to **register the pattern** so the next contributor adding visual surface picks it up without redoing the audit.

## The pattern in one paragraph

A release-time GitHub Actions job boots the example app's built site behind a static HTTP server (no Electron, no devserver), drives it through a locale × theme matrix using `browser.newContext({ locale })` + `commander.emulateMedia({ colorScheme })` + a `localStorage` theme key, captures fresh screenshots via `commander.page.screenshot()` (because `browser-commander@0.8` exposes the raw Playwright page; the package has no native screenshot method as of 0.10.1), then uses `git status --porcelain` drift detection and `git commit -m "... [skip ci]"` to push the drift back to `main`. `PREVIEW_VERBOSE=1` dumps DOM probes (`data-theme`, `lang`, `h1` contents) so CI failures are diagnosable from logs alone.

## Reference implementation

The canonical implementation to mirror (do not re-derive):

- Script: [`scripts/update-preview-images.mjs`](https://github.com/konard/vk-bot-desktop/blob/issue-51-60ec0489f01f/scripts/update-preview-images.mjs) in `vk-bot-desktop`.
- Workflow job: the [`preview-regen` job](https://github.com/konard/vk-bot-desktop/blob/issue-51-60ec0489f01f/.github/workflows/js.yml#L657) in `.github/workflows/js.yml`.
- Triggers: push to `main`, release tag pushes, and `workflow_dispatch`.

For this Rust template the screenshot script does **not** need to be Rust-native. The `scripts/` directory can shell out to a Node-only script identical to the JavaScript one. Keeping the script in Node sidesteps re-implementing Playwright bindings in Rust and matches the rest of the `link-foundation` ecosystem.

## Activation checklist (apply when an example-app surface lands)

When a future PR adds a visual surface to this template, follow this checklist in order. Each item maps directly to a building block in the upstream recipe.

1. **Identify the screenshot target.** Decide whether the screenshot source is the example app's built site (preferred), a static Pages site, or a headless renderer. The site must be servable over plain HTTP.
2. **Add a Node-only screenshot script.** Copy [`scripts/update-preview-images.mjs`](https://github.com/konard/vk-bot-desktop/blob/issue-51-60ec0489f01f/scripts/update-preview-images.mjs) verbatim, adjust the input/output paths, and keep it in `scripts/` next to the Rust scripts. Do not port it to Rust.
3. **Pin `browser-commander` and Playwright.** Match the pin already used by sibling repos. As of the reference implementation, `browser-commander` is on `0.8` and exposes the raw Playwright page via `commander.page` — so screenshots go through `commander.page.screenshot()`, not a wrapper.
4. **Add a `preview-regen` job to `.github/workflows/release.yml`** (or a new `example-app.yml` if/when the Rust template grows one). The job runs on push to `main`, on release tag pushes, and on `workflow_dispatch`.
5. **Drive the locale × theme matrix from the workflow.** Use `browser.newContext({ locale })` for locale and `commander.emulateMedia({ colorScheme })` + `localStorage` for theme. Do not toggle theme through a UI segmented control — emulation is deterministic, UI toggling is not.
6. **Serve, do not devserver.** Spin up a static HTTP server over the built site (`npx serve` or equivalent) inside the job. Avoid devservers and avoid Electron, which the upstream recipe explicitly sidesteps.
7. **Drift detection + push-back.** Use `git status --porcelain` to detect changed bytes. When changes exist, `git add`, `git commit -m "chore(preview): regenerate preview images [skip ci]"`, and `git push`. The `[skip ci]` token is what keeps the loop from re-triggering itself.
8. **Diagnostic verbosity.** Wire a `PREVIEW_VERBOSE=1` env flag through the script that dumps `data-theme`, `lang`, and visible `h1` contents at capture time. Without this, CI failures in headless mode are nearly undebuggable from logs alone.
9. **Concurrency guard.** Add `concurrency: { group: preview-regen-${{ github.ref }}, cancel-in-progress: false }` to the job so back-to-back pushes don't race each other on the `[skip ci]` commit.
10. **Backfill a changelog fragment.** Use `bump: minor` because the new job is a feature, not a fix. Reference this case study from the fragment so the connection to issue #52 survives the changelog collection step.

## Why each building block matters

- **Static HTTP server, not Electron or devserver.** The upstream `vk-bot-desktop` recipe is intentionally renderer-only at screenshot time. This keeps the job runnable on a vanilla `ubuntu-latest` runner without GPU, display server, or Electron build artifacts.
- **`browser.newContext({ locale })` for locale.** Driving locale through the browser context is deterministic, parallelizable across contexts, and does not depend on the app exposing a locale switcher. Switching locale via in-UI controls forces serial state and adds a class of "wrong locale was captured" bugs.
- **`emulateMedia({ colorScheme })` + `localStorage` for theme.** `emulateMedia` covers system-driven theme detection. `localStorage` covers apps that persist explicit user choice. Both together cover the matrix of apps that use either signal or both.
- **`commander.page.screenshot()`, not a wrapper.** `browser-commander@0.8` (and through `0.10.1`) does not expose a screenshot method on the commander itself — only on the raw Playwright page. Calling `commander.page.screenshot()` is the documented escape hatch; future versions may add a wrapper, but this one is stable today.
- **`[skip ci]` on the drift commit.** Without `[skip ci]`, the drift commit re-triggers the workflow, which captures the same (now stable) screenshots, finds no drift, and exits. That is non-fatal but wastes a runner. With `[skip ci]`, the loop is self-terminating.
- **`PREVIEW_VERBOSE=1` DOM probes.** Headless Playwright failures often surface as "screenshot looks wrong" with no log signal. Dumping `data-theme`, `lang`, and `h1` contents at capture time turns those failures into single-glance diagnosis: "wrong theme was applied", "locale didn't load", "page didn't render".

## Parity with sibling templates

The same tracking issue exists for the C# template ([`csharp-ai-driven-development-pipeline-template#17`](https://github.com/link-foundation/csharp-ai-driven-development-pipeline-template/issues/17)) and the Python template ([`python-ai-driven-development-pipeline-template#9`](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/9)). All four templates (JS, Rust, C#, Python) are expected to converge on the same `preview-regen` job shape, so when one of them ships the first real implementation the other three should mirror it.

When this template adopts the pattern, also:

1. Comment on the upstream JS issue ([#62](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/62)) linking the implementation PR here.
2. Cross-link the sibling C# and Python tracking issues.
3. Update this case study from "tracking" to "implemented", adding before/after CI run links and a link to the implementation PR.

## Collected Data

Raw GitHub data is stored in `raw-data/`:

- `issue-52.json` — the tracking issue at the time of registration.
- `issue-52-comments.json` — issue comments at the time of registration (empty until the implementation PR lands).
- `js-issue-62.json` — the primary upstream tracking issue on the JS template.
- `vk-bot-desktop-issue-51.json` — the original problem statement that prompted the recipe.
- `vk-bot-desktop-pr-52.json` — the reference implementation PR.

## Status

**Tracking — no implementation in this template yet.** The pattern is registered here and ready to be applied as soon as an example-app surface lands. The pull request that registers this case study makes documentation-only changes and does not modify any workflow, script, or runtime code.
