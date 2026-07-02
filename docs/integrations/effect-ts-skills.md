# Effect TS Skills

The repository includes the `effect-ts-guide` Codex skill from `ProverCoderAI/effect-ts-skills` as a project-scoped skill through a git submodule.

## Source

- Repository: https://github.com/ProverCoderAI/effect-ts-skills
- Submodule path: `third_party/effect-ts-skills`
- Skill source path: `third_party/effect-ts-skills/plugins/effect-ts-skills/skills/effect-ts-guide`
- Submodule commit: `178adff12f5bf020b55e1aef347e2258e5033192`
- Project skill path: `.codex/skills/effect-ts-guide`

`.codex/skills/effect-ts-guide` is a symlink to the submodule skill directory. This keeps Codex discovery on the usual project-scoped skill path without copying the upstream skill files into this repository.

## Usage

Codex can use the skill directly from this workspace when a task mentions `$effect-ts-guide` or asks for Effect-TS compliance work.

The submodule skill bundles a reusable `effect-ts-check` runner and tarball asset, so the OpenAPI Effect boundary can be checked without installing the plugin globally:

```bash
bun run effect:skill:check
```

The check command initializes `third_party/effect-ts-skills` first. To only initialize the submodule, run:

```bash
bun run effect:skill:init
```

For exploratory migration scans across more of the monorepo, run the bundled checker directly and choose the target paths:

```bash
bash .codex/skills/effect-ts-guide/scripts/run-effect-ts-check.sh <paths> --profile minimal
bash .codex/skills/effect-ts-guide/scripts/run-effect-ts-check.sh <paths> --profile strict
```

## Current Scope

`bun run effect:skill:check` is intentionally scoped to the OpenAPI Effect client boundary that is currently green under the strict profile. A full monorepo scan still reports known legacy migration violations in API and session-sync code, so it is useful as backlog discovery rather than a merge gate.

## Update Procedure

Initialize the submodule after cloning this repository:

```bash
bun run effect:skill:init
```

To refresh the project skill from upstream:

```bash
git -C third_party/effect-ts-skills fetch origin main
git -C third_party/effect-ts-skills checkout <commit-or-origin/main>
git add third_party/effect-ts-skills
```

After updating, run:

```bash
bun run effect:skill:check
```
