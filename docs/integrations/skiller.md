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

The docker-git web terminal header includes a `Skiller` button next to `Open browser`. In a project terminal the button calls `POST /projects/by-key/:projectKey/terminal-sessions/:sessionId/skiller/open` first. By default the controller stores the external Skiller Web launch URL for `https://skiller-web-henna.vercel.app/launch` and returns a short docker-git wrapper path such as `/api/skiller/external-launch/<id>`. The saved target carries `backendUrl`, `projectKey`, and `sessionId` parameters, while the browser address bar keeps the short wrapper URL. When docker-git web is served through the `/api` proxy, `backendUrl` includes that forwarded prefix so Skiller Web can call back to the same browser-reachable docker-git endpoint.

Hosted Skiller Web is served over HTTPS, so browser fetches to a plain `http://192.168.x.x:4174/api` backend can be blocked before they reach docker-git. If external Skiller Web is enabled and no explicit backend override is configured, docker-git automatically starts or reuses the panel Cloudflare Quick Tunnel for local/private HTTP origins and sends Skiller Web an HTTPS callback URL such as `https://<name>.trycloudflare.com/api`. Follow-up API calls through that tunnel preserve the HTTPS forwarded protocol so the controller does not try to create a nested tunnel.

External Skiller Web is controlled by these API/controller environment variables:

- `DOCKER_GIT_SKILLER_WEB_URL` sets the Skiller Web base URL. The compose default is `https://skiller-web-henna.vercel.app`.
- `DOCKER_GIT_SKILLER_BACKEND_URL` overrides the callback base URL sent to Skiller Web and disables automatic tunnel URL selection.
- `DOCKER_GIT_API_PUBLIC_URL` is the secondary callback override when `DOCKER_GIT_SKILLER_BACKEND_URL` is unset and also disables automatic tunnel URL selection.
- `DOCKER_GIT_SKILLER_ALLOWED_ORIGINS` adds comma-separated trusted Skiller Web origins for CORS.

Set `DOCKER_GIT_SKILLER_WEB_URL=` to force the legacy bundled renderer flow. `DOCKER_GIT_CONTROLLER_BUILD_SKILLER=0` only controls whether the controller image bundles the Skiller submodule; it does not enable external Web mode by itself.

In the legacy bundled mode, docker-git launches the pinned submodule Electron app as a separate process, registers the terminal session filesystem scope, writes launcher output to `~/.docker-git/logs/skiller.log`, serves Skiller's built renderer from the submodule, and proxies `/api/ssh/session/:sessionId/skiller/trpc/*` to the running Skiller tRPC backend. The session id is part of the URL so a Skiller tab can be tied back to the terminal container that opened it.

For project terminals, docker-git scopes Skiller to the active project container filesystem. The API inspects the selected project container mounts, maps `/home/<sshUser>` and the project `targetDir` to the controller-visible Docker volume path, launches or reuses the local Skiller runtime with `HOME` set to that mapped home directory, and registers the mapped project directory in Skiller. This makes global skill operations target the selected container home and project skill operations target the selected container project directory. If the controller cannot access the Docker volume path, the endpoint fails instead of opening Skiller against the wrong filesystem.

For Codex, Skiller resolves `~/.codex/skills` against the selected container home volume. For example, `/home/dev/.codex/skills` inside the selected container is exposed to the controller as the mapped Docker volume path and is the only Codex global skill tree used for that session. docker-git does not fall back to the controller's own `~/.codex/skills`.

When the API process has no `$DISPLAY`, the legacy bundled launcher uses `xvfb-run` if it is available so Skiller can still start in a headless controller environment.

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

This integration keeps the Skiller runtime and filesystem scope owned by docker-git while the default browser UI is served by external Skiller Web. The pinned submodule remains available for legacy bundled rendering and local development, but docker-git does not import Skiller source into the docker-git web bundle.
