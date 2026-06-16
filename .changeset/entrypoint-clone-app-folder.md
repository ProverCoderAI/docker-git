---
"@prover-coder-ai/docker-git": patch
---

Fix the standalone base image cloning the repo outside the prepared `app` folder.

The Dockerfile prepares and chowns `/home/dev/app` to the unprivileged `dev`
user, but `entrypoint.sh` defaulted `TARGET_DIR` to `/work/app`. Because the
auto-clone runs as `su - dev`, cloning into the root-created `/work/app` failed
with permission denied, so the repository never landed in the `app` folder.
The default now points at `/home/dev/app`, and the resolved `TARGET_DIR` is
chowned to `dev` so overrides outside `/home/dev` keep working too.
