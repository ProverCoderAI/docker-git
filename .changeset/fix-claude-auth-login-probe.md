---
"@prover-coder-ai/docker-git": patch
---

Fix `docker-git auth claude login` failing after a successful OAuth login.

After `claude setup-token` created and persisted the OAuth token, the login
command ran a verification probe (`claude -p ping`) and treated any non-zero
exit as a hard failure, exiting with code 1 even though the token was already
saved. A transient probe failure (network hiccup, rate limit, or token
propagation delay) would therefore discard an otherwise successful login.

The probe failure is now reported as a warning instead of an error, mirroring
`docker-git auth claude status`. The token is kept, and the user is advised to
re-check connectivity later with `docker-git auth claude status`.
