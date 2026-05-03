# docker-git API

HTTP API for docker-git orchestration (projects, agents, logs/events, federation).

This is now the intended controller plane:
- the API runs inside `docker-git-api`
- `.docker-git` state lives in the Docker volume `docker-git-projects`
- the API talks to Docker through `/var/run/docker.sock`
- child project containers no longer depend on host bind mounts for bootstrap auth/env

## UI wrapper

After API startup open:

- `http://localhost:3334/`

This page is a built-in UI shell for manual API checks without CLI.

## Run (local)

```bash
bun run --cwd packages/api build
bun run --cwd packages/api start
```

## Run (dedicated Docker for API)

From repository root:

```bash
docker compose up -d --build
./ctl health
```

Default port mapping:

- host: `127.0.0.1:3334`
- container: `3334`

Optional env:

- `DOCKER_GIT_API_BIND_HOST` (default: `127.0.0.1`)
- `DOCKER_GIT_API_PORT` (default: `3334`)
- `DOCKER_GIT_PROJECTS_ROOT` (container path, default: `/home/dev/.docker-git`)
- `DOCKER_GIT_PROJECTS_ROOT_VOLUME` (Docker volume name for controller state, default: `docker-git-projects`)
- `DOCKER_GIT_FEDERATION_PUBLIC_ORIGIN` (optional public ActivityPub origin)
- `DOCKER_GIT_FEDERATION_ACTOR` (default: `docker-git`)
- `DOCKER_GIT_EXCHANGE_TARGETS` (optional comma-separated exchange targets, e.g. `https://exchange.lefine.pro` or `code@exchange.lefine.pro`)
- `DOCKER_GIT_EXCHANGE_PROJECT_REPO_URL` (fallback repo for exchange Tickets without a GitHub URL)
- `DOCKER_GIT_EXCHANGE_AGENT_PROVIDER` (default: `codex`; also supports `claude`, `opencode`, `custom`)
- `DOCKER_GIT_EXCHANGE_AGENT_COMMAND` (optional command template; `{{prompt}}` is replaced with the task prompt)
- `DOCKER_GIT_EXCHANGE_AGENT_TIMEOUT_MS` (default: `3600000`)
- `DOCKER_GIT_OUTBOX_POLLING_INTERVAL_MS` (default: `5000`)

## Endpoints

- `GET /health`
- `POST /federation/inbox` (ForgeFed `Ticket` / `Offer(Ticket)`, ActivityPub `Accept` / `Reject`)
- `GET /federation/issues`
- `GET /federation/actor` (ActivityPub `Person`)
- `GET /federation/outbox`
- `GET /federation/followers`
- `GET /federation/following`
- `GET /federation/liked`
- `POST /federation/exchange/subscriptions` (discover remote actor, persist metadata, send signed `Follow`)
- `GET /federation/exchange/subscriptions`
- `POST /federation/exchange/poll` (manual remote outbox poll)
- `POST /federation/follows` (create ActivityPub `Follow` subscription)
- `GET /federation/follows`
- `GET /projects`
- `GET /projects/:projectId`
- `POST /projects`
- `DELETE /projects/:projectId`
- `POST /projects/:projectId/up`
- `POST /projects/:projectId/down`
- `POST /projects/:projectId/recreate`
- `GET /projects/:projectId/ps`
- `GET /projects/:projectId/logs`
- `GET /projects/:projectId/events` (SSE)
- `POST /projects/:projectId/agents`
- `GET /projects/:projectId/agents`
- `GET /projects/:projectId/agents/:agentId`
- `GET /projects/:projectId/agents/:agentId/attach`
- `POST /projects/:projectId/agents/:agentId/stop`
- `GET /projects/:projectId/agents/:agentId/logs`

## Subscription workflow (ActivityPub Follow + ForgeFed issues)

Exchange targets must be explicit. Use `https://exchange.lefine.pro`, an actor URL, or a handle like `code@exchange.lefine.pro`; the API resolves the code actor document, stores its `inbox/outbox/followers/publicKey`, sends `Follow`, and polls the stored `outbox`.

```bash
./ctl request POST /federation/exchange/subscriptions '{
  "domain":"https://social.provercoder.ai",
  "target":"https://exchange.lefine.pro",
  "projectRepoUrl":"https://github.com/ProverCoderAI/docker-git",
  "agentProvider":"codex"
}'

./ctl request POST /federation/exchange/poll '{}'
./ctl request GET /federation/exchange/subscriptions
./ctl request GET /federation/issues
```

When a polled `Create(Ticket)` has no GitHub URL in the Ticket payload, `projectRepoUrl` or `DOCKER_GIT_EXCHANGE_PROJECT_REPO_URL` is required for the automatic docker-git project/agent run.

1. Read actor profile (contains `inbox/outbox/followers/following/liked`):

```bash
./ctl request GET /federation/actor
```

2. Create follow subscription:

```bash
./ctl request POST /federation/follows '{
  "domain":"https://social.provercoder.ai",
  "actor":"https://dev.example/users/bot",
  "object":"https://tracker.example/issues/followers",
  "capability":"https://tracker.example/caps/follow"
}'
```

`domain` is used as public origin. `.example` hosts in `actor/object/capability` are normalized to that domain.

3. Confirm subscription by sending `Accept` into inbox:

```bash
./ctl request POST /federation/inbox '{
  "@context":"https://www.w3.org/ns/activitystreams",
  "type":"Accept",
  "object":"https://social.provercoder.ai/federation/activities/follows/<id>"
}'
```

4. Verify follow state and collections:

```bash
./ctl request GET /federation/follows
./ctl request GET /federation/following
./ctl request GET /federation/outbox
```

5. Push issue offer through ForgeFed inbox:

```bash
./ctl request POST /federation/inbox '{
  "@context":["https://www.w3.org/ns/activitystreams","https://forgefed.org/ns"],
  "id":"https://social.provercoder.ai/offers/42",
  "type":"Offer",
  "target":"https://social.provercoder.ai/issues",
  "object":{
    "type":"Ticket",
    "id":"https://social.provercoder.ai/issues/42",
    "attributedTo":"https://origin.provercoder.ai/users/alice",
    "summary":"Need reproducible CI parity",
    "content":"Implement API behavior matching CLI."
  }
}'
```

6. Verify persisted issues:

```bash
./ctl request GET /federation/issues
```
