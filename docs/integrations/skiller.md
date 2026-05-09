# Skiller Integration

Skiller is included as an isolated git submodule so docker-git can reuse the upstream desktop skills manager without mixing Electron dependencies into the docker-git Bun workspace.

## Upstream

- Repository: https://github.com/beautyfree/skiller-desktop-skills-manager
- Path: `third_party/skiller-desktop-skills-manager`
- Pinned version: `v0.2.14`
- Pinned commit: `6ff6b9ca1ff2d78d3af7dac47b03ed1c315dab6b`
- License: MIT, copyright 2025 Skiller Contributors

The submodule is intentionally outside `packages/*` and is not listed in the root workspace. This keeps the existing docker-git `build`, `check`, `typecheck`, and `test` scripts scoped to docker-git packages unless a Skiller-specific script is run.

## Commands

Initialize the pinned submodule:

```bash
bun run skiller:init
```

Install Skiller dependencies inside the submodule:

```bash
bun run skiller:install
```

Run Skiller as its own Electron app:

```bash
bun run skiller:dev
```

Run Skiller checks:

```bash
bun run skiller:check
```

## docker-git Web Launch

The docker-git web terminal header includes a `Skiller` button next to `Open browser`. In a project terminal the button opens `/api/ssh/session/:sessionId/skiller/app/` immediately, using the same terminal session id that is present in `/ssh/session/:sessionId`. It also calls `POST /projects/by-key/:projectKey/terminal-sessions/:sessionId/skiller/open`, which launches the pinned submodule Electron app as a separate process and writes launcher output to `~/.docker-git/logs/skiller.log`.

docker-git serves Skiller's built renderer from the submodule and proxies `/api/ssh/session/:sessionId/skiller/trpc/*` to the running Skiller tRPC backend, so the user sees the actual Skiller UI instead of an invisible background desktop process. The session id is part of the URL so a Skiller tab can be tied back to the terminal container that opened it.

For project terminals, docker-git scopes Skiller to the active project container filesystem. The API inspects the selected project container mounts, maps `/home/<sshUser>` and the project `targetDir` to the controller-visible Docker volume path, launches Skiller with `HOME` set to that mapped home directory, and registers the mapped project directory in Skiller. This makes global skill operations target the selected container home and project skill operations target the selected container project directory. If the controller cannot access the Docker volume path, the endpoint fails instead of opening Skiller against the wrong filesystem.

For Codex, Skiller resolves `~/.codex/skills` against the selected container home volume. For example, `/home/dev/.codex/skills` inside the selected container is exposed to the controller as the mapped Docker volume path and is the only Codex global skill tree used for that session. docker-git does not fall back to the controller's own `~/.codex/skills`.

When the API process has no `$DISPLAY`, the launcher uses `xvfb-run` if it is available so Skiller can still start in a headless controller environment.

## PR #238 Proof

The latest Playwright proof screenshots are checked in under `docs/screenshots/issue-237/proof/`:

- `pr238-proof-27-terminal-skiller-same-session.png` shows the attached terminal with the `Skiller` button.
- `pr238-proof-28-skiller-session-scoped-ui.png` shows the real Skiller UI opened from that button.
- `pr238-proof-29-skiller-codex-container-skill.png` shows a Codex skill discovered from the selected container's `/home/dev/.codex/skills` tree.
- `pr238-proof-30-skiller-add-project-folder-browser-picker.png` shows the browser-visible project folder picker opened from `Add project folder...` with selected-container paths.

## Updating the Pin

Update Skiller only as an explicit dependency change:

```bash
git -C third_party/skiller-desktop-skills-manager fetch --tags origin
git -C third_party/skiller-desktop-skills-manager checkout <tag-or-commit>
git add third_party/skiller-desktop-skills-manager
```

After changing the pin, run both docker-git checks and Skiller checks:

```bash
bun run typecheck
bun run check
bun run skiller:check
```

## Integration Boundary

This integration makes Skiller part of the docker-git checkout and developer workflow. docker-git keeps Skiller as an isolated submodule and does not import Skiller source into the docker-git web bundle. The visible browser view is served from Skiller's own built renderer and backed by Skiller's own tRPC process.
