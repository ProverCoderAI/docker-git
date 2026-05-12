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

The docker-git web terminal header includes a `Skiller` button next to `Open browser`. In a project terminal the button calls `POST /projects/by-key/:projectKey/terminal-sessions/:sessionId/skiller/open` first, which launches the pinned submodule Electron app as a separate process, registers the terminal session filesystem scope, and writes launcher output to `~/.docker-git/logs/skiller.log`. After that response succeeds, the browser opens the returned `/api/ssh/session/:sessionId/skiller/app/` URL using the same terminal session id that is present in `/ssh/session/:sessionId`.

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
- `pr238-proof-31-skiller-project-scoped-folder-picker-working.png` shows `/api/skiller/app/` opened from a project-scoped Skiller process with `Add project folder...` resolving to the selected container paths.
- `pr238-proof-32-docker-git-browser-live-command.png` shows the live `docker-git browser` frontend served through the same controller used for the proof.
- `pr238-proof-33-skiller-session-folder-picker-mcp.png` shows the terminal session-scoped Skiller URL opened from the real `Skiller` button and the `Add project folder...` picker resolving to `dg-skiller-button-demo:/home/dev/app`.
- `pr238-proof-34-skiller-container-skill-paths.png` shows the session-scoped Skiller skill detail rendering the Codex skill path as `/home/dev/.codex/skills/...` instead of the controller Docker volume path.
- `pr238-proof-35-skiller-container-project-paths.png` shows the Skiller Projects view rendering the active project as `/home/dev/app` instead of the controller Docker volume path.
- `pr238-proof-36-skiller-system-prompts-ui.png` shows the real session-scoped Skiller Projects UI with project and global system prompt editors backed by the selected container paths.
- `pr238-proof-37-skiller-global-system-prompt-ui.png` shows the same Skiller UI after saving a global Codex system prompt at `/home/dev/.codex/AGENTS.md`.
- `pr238-proof-38-skiller-russian-system-prompts.png` shows Skiller rendering existing docker-git-managed Claude and Gemini global prompts as readable UTF-8 Russian text instead of literal `\u0422...` escapes.

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
