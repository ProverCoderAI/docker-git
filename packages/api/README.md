# docker-git API

HTTP API for docker-git orchestration (projects, agents, logs/events, federation).

This is now the intended controller plane:
- the API runs inside `docker-git-api`
- `.docker-git` state lives in the Docker volume `docker-git-projects`
- the API uses the host Docker daemon by default via `/var/run/docker.sock`
- child project containers use host-backed Docker unless an explicit
  `DOCKER_GIT_PROJECT_DOCKER_HOST` is provided

## Runtime contract: host-Docker-backed

`docker-git` is host-Docker-backed by default. The primary controller
container created from this package binds the host socket and Docker data root
(`/var/run/docker.sock:/var/run/docker.sock` and
`/var/lib/docker:/var/lib/docker`, see `docker-compose.yml`) and uses them to
spawn per-project containers and access the Docker volume paths reported by
`docker inspect`. `DOCKER_GIT_DOCKER_RUNTIME=isolated` is an opt-in fallback for
environments that explicitly require an embedded controller daemon. In isolated
mode, start the controller through the host CLI or include
`docker-compose.isolated.yml`; that overlay removes the host socket bind, keeps
Docker data inside the controller volume, and defaults project containers to the
embedded daemon endpoint `tcp://host.docker.internal:2375`.

Security note: binding `/var/run/docker.sock` gives the controller container
root-equivalent control over the host Docker daemon, including the ability to
create containers and mount host paths. This is an intended trade-off for the
host-backed architecture; run the controller only in trusted environments and
review the threat model before exposing the API.

The host CLI (`packages/app`) also talks to that same daemon directly when
it bootstraps the controller. Three failure modes look identical at first
glance and the CLI now distinguishes them in its error output:

- **Host daemon down** – `docker info` cannot connect. Start the host
  Docker daemon or set `DOCKER_HOST`.
- **Host socket permission mismatch** – `docker info` returns
  `permission denied` on `/var/run/docker.sock`. Fix host group membership
  (`docker` group / rootless Docker / socket ownership). This is a host
  configuration problem, not a `docker-git` outage.
- **Controller container not running / unreachable** – the API at
  a custom `DOCKER_GIT_API_URL` does not answer. Bring the controller up
  with `docker compose up -d --build` or point the CLI at an existing
  controller via `DOCKER_GIT_API_URL`. The default local value
  (`http://127.0.0.1:3334`, `http://localhost:3334`, or `http://[::1]:3334`)
  does not block local Docker bootstrap.

Diagnostic classification + remediation messages live in
`packages/app/src/docker-git/controller-docker-diagnostics.ts` and are
covered by `packages/app/tests/docker-git/controller-docker-diagnostics.test.ts`.

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

Isolated fallback:

```bash
DOCKER_GIT_DOCKER_RUNTIME=isolated \
  docker compose -f docker-compose.yml -f docker-compose.isolated.yml up -d --build
./ctl health
```

Default port mapping:

- host: `127.0.0.1:3334`
- container: `3334`

Optional env:

- `DOCKER_GIT_API_BIND_HOST` (default: `127.0.0.1`)
- `DOCKER_GIT_API_PORT` (default: `3334`)
- `DOCKER_GIT_DOCKER_RUNTIME` (default: `host`; set to `isolated` as an optional fallback to use an embedded controller daemon)
- `DOCKER_GIT_CONTROLLER_DOCKER_HOST` (default: `unix:///var/run/docker.sock`; socket path inside the controller)
- `DOCKER_GIT_CONTROLLER_PRIVILEGED` (default: `false` in host mode; isolated overlays default it to `true` for the embedded Docker daemon)
- `DOCKER_GIT_DOCKERD_TCP_HOST` (default: `tcp://0.0.0.0:2375`; reachable only inside Docker networks unless explicitly published)
- `DOCKER_GIT_DOCKERD_DEFAULT_CGROUPNS_MODE` (default: `host`; keeps nested project containers compatible with cgroup v2 DinD)
- `DOCKER_GIT_PROJECT_DOCKER_HOST` (default: empty in host mode; isolated mode defaults to `tcp://host.docker.internal:2375`)
- `DOCKER_GIT_PROJECT_SSH_BIND_HOST` (default: `0.0.0.0`)
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
- `GET /.well-known/webfinger` (Fedify WebFinger document for the local federation actor)
- `GET /federation/issues`
- `GET /federation/actor` (ActivityPub `Person`)
- `GET /federation/outbox`
- `GET /federation/followers`
- `GET /federation/following`
- `GET /federation/liked`
- `GET /federation/status` (connection summary and recent exchange events)
- `GET /federation/exchange/status` (connection summary and recent exchange events)
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

Local ActivityPub documents are serialized with Fedify and use only the supported ActivityStreams and security JSON-LD contexts. Mastodon-specific extension contexts and keys such as `https://purl.archive.org/socialweb/webfinger`, `toot`, `featured`, `featuredTags`, `alsoKnownAs`, `movedTo`, and `interactionPolicy` are not emitted by docker-git.

The local actor is discoverable through WebFinger:

```bash
./ctl request GET '/.well-known/webfinger?resource=acct:docker-git@social.provercoder.ai'
```

```bash
./ctl request POST /federation/exchange/subscriptions '{
  "domain":"https://social.provercoder.ai",
  "target":"https://exchange.lefine.pro",
  "projectRepoUrl":"https://github.com/ProverCoderAI/docker-git",
  "agentProvider":"codex"
}'

./ctl request POST /federation/exchange/poll '{}'
./ctl request GET /federation/status
./ctl request GET /federation/exchange/subscriptions
./ctl request GET /federation/issues
```

`GET /federation/status` is the live observability endpoint for a Lefine connection. `GET /federation/exchange/status` is kept as a compatibility alias. It reports subscription counts, accepted/pending/rejected state, `lastInboxAt`, `lastPollAt`, persisted issue count, processed outbox items, and recent events such as `follow.sent`, `inbox.follow.accept`, `inbox.issue.received`, and `poll.completed`.

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
