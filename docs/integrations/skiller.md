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

The docker-git web terminal header includes a `Skiller` button next to `Open browser`. The button calls `POST /skiller/open`, which launches the pinned submodule Electron app as a separate process and writes launcher output to `~/.docker-git/logs/skiller.log`.

The same click opens `/api/skiller/app/` in the browser. docker-git serves Skiller's built renderer from the submodule and proxies `/api/skiller/trpc/*` to the running Skiller tRPC backend, so the user sees the actual Skiller UI instead of an invisible background desktop process.

When the API process has no `$DISPLAY`, the launcher uses `xvfb-run` if it is available so Skiller can still start in a headless controller environment.

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
