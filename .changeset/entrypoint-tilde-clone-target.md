---
"@prover-coder-ai/docker-git": patch
---

Fix `docker-git clone` leaving the workspace `app` folder empty when `TARGET_DIR`
is a tilde path.

The generated entrypoint runs as `root` (sshd), so `$HOME` resolves to `/root`.
When a `~`/`~/...` `TARGET_DIR` reached the entrypoint (e.g. via the `TARGET_DIR`
env override), it was expanded against `$HOME`, resolving to `/root/app`. Because
the auto-clone runs as `su - <sshUser>`, cloning into the root-owned `/root/app`
failed with "permission denied", so the repository never landed in the prepared
home and the workspace `app` folder stayed empty. The tilde is now expanded
against the unprivileged user's home `/home/<sshUser>`, so the clone always lands
in the dev-owned workspace.
