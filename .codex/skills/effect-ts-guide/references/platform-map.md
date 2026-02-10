# @effect/platform map (what it replaces)

## Core idea

- @effect/platform provides platform-neutral service interfaces and Layers.
- It does not monkey-patch globals; you must provide a platform layer.

## Implementation packages

- Node: @effect/platform-node
- Bun: @effect/platform-bun
- Browser: @effect/platform-browser

## Common mappings

- FileSystem -> node:fs / fs.promises / Bun file APIs
- Path -> node:path / Bun path / Deno path
- Command (+ CommandExecutor) -> child_process.spawn/exec / Deno.Command / Bun.spawn
- Terminal -> process.stdin/stdout / readline
- KeyValueStore -> Map / localStorage / file-backed KV
- PlatformConfigProvider -> dotenv + process.env + file tree config
- PlatformLogger -> console + file logging
- Runtime/runMain -> manual main + process signal handling

## HTTP stack

- HttpClient -> fetch / undici / axios
- FetchHttpClient -> fetch implementation
- HttpServer/HttpRouter/HttpMiddleware -> node:http + express/fastify/koa
- HttpApi/OpenApi -> manual route + schema + OpenAPI toolchain

## Sockets and workers

- Socket/SocketServer -> net / ws / WebSocket
- Worker/WorkerRunner -> worker_threads / Web Workers

## Data and utilities

- Headers/Cookies/Multipart/Etag -> manual header/cookie parsing or third-party middleware
- Url/UrlParams -> URL / URLSearchParams
- Ndjson/MsgPack -> ad-hoc codecs or third-party libs
