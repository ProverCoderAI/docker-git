# Scrap Artifacts Sample

This directory contains small, safe-to-commit examples of the files produced by `docker-git scrap`.

## Session mode
`session/<snapshotId>/` contains:
- `manifest.json`
- `worktree.patch.gz.part*` + `worktree.patch.gz.chunks.json`
- `codex.tar.gz.part*` + `codex.tar.gz.chunks.json`
- `codex-shared.tar.gz.part*` + `codex-shared.tar.gz.chunks.json`

Notes:
- The codex tarballs in this sample are empty (no secrets).

## Cache mode
`cache/` contains:
- `workspace.tar.gz.part*` + `workspace.tar.gz.chunks.json`

All parts are kept under 99MB (GitHub blob limit friendly).
