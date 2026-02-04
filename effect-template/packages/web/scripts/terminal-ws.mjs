import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { Client } from "ssh2";
import { spawn } from "node:child_process";
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import { readProjectConfig as readProjectConfigEffect } from "@effect-template/lib/shell/config";
import { createProject } from "@effect-template/lib/usecases/actions";

const basePort = Number(process.env.TERMINAL_WS_PORT ?? "3001");
const maxAttempts = 20;
const infoFile = "/tmp/docker-git-terminal-ws.json";
const sessionsFile = "/tmp/docker-git-terminal-sessions.json";
const sessions = new Map();

const nowIso = () => new Date().toISOString();

// CHANGE: persist active terminal sessions for discovery
// WHY: expose running terminals to the web UI and agents
// QUOTE(ТЗ): "мы можем получать список всех запущенных терминалов?"
// REF: user-request-2026-02-04-terminal-sessions
// SOURCE: n/a
// FORMAT THEOREM: ∀s ∈ sessions: stored(s) → visible(s)
// PURITY: SHELL
// EFFECT: Effect<void, never, never>
// INVARIANT: session.id уникален в registry
// COMPLEXITY: O(n)
const writeSessions = () => {
  try {
    const payload = {
      updatedAt: nowIso(),
      sessions: Array.from(sessions.values())
    };
    fs.writeFileSync(sessionsFile, JSON.stringify(payload, null, 2));
  } catch {
    // Ignore telemetry write failures.
  }
};

writeSessions();

const registerSession = (session) => {
  sessions.set(session.id, { ...session, updatedAt: nowIso() });
  writeSessions();
};

const updateSession = (sessionId, patch) => {
  const current = sessions.get(sessionId);
  if (!current) {
    return;
  }
  sessions.set(sessionId, { ...current, ...patch, updatedAt: nowIso() });
  writeSessions();
};

const removeSession = (sessionId) => {
  if (!sessions.has(sessionId)) {
    return;
  }
  sessions.delete(sessionId);
  writeSessions();
};

const nextSessionId = () => {
  try {
    return randomUUID();
  } catch {
    return `term-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
};

const sendMessage = (socket, payload) => {
  if (socket.readyState !== socket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(payload));
};

const decodeMessage = (raw) => {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.type === "input" && typeof parsed.data === "string") {
      return parsed;
    }
    if (parsed.type === "resize" && typeof parsed.cols === "number" && typeof parsed.rows === "number") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
};

const readProjectTemplate = (projectDir) => {
  const configPath = path.join(projectDir, "docker-git.json");
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw);
  return parsed?.template ?? parsed;
};

const findKeyPath = (startDir) => {
  let current = startDir;
  const root = path.parse(startDir).root;
  while (true) {
    const candidate = path.join(current, "dev_ssh_key");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    if (current === root) {
      break;
    }
    current = path.dirname(current);
  }
  return path.join("/home/user/docker-git", "dev_ssh_key");
};

const runComposeUp = (projectDir) =>
  new Promise((resolve, reject) => {
    const child = spawn("docker", ["compose", "up", "-d", "--build"], {
      cwd: projectDir,
      stdio: "ignore"
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`docker compose up failed (${code})`));
      }
    });
    child.on("error", reject);
  });

const runComposeWithLogs = (projectDir, args, socket, label) =>
  new Promise((resolve, reject) => {
    sendMessage(socket, { type: "info", data: `[recreate] ${label}` });
    const child = spawn("docker", ["compose", ...args], {
      cwd: projectDir,
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.on("data", (data) => {
      sendMessage(socket, { type: "output", data: data.toString("utf8") });
    });
    child.stderr.on("data", (data) => {
      sendMessage(socket, { type: "output", data: data.toString("utf8") });
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`docker compose ${args.join(" ")} failed (${code})`));
      }
    });
    child.on("error", reject);
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runRecreateFlow = async (projectDir, socket) => {
  await runComposeWithLogs(projectDir, ["down", "--volumes"], socket, "docker compose down --volumes");
  sendMessage(socket, { type: "info", data: "[recreate] syncing project files" });
  const program = Effect.gen(function*(_) {
    const config = yield* _(readProjectConfigEffect(projectDir));
    yield* _(
      createProject({
        _tag: "Create",
        config: config.template,
        outDir: projectDir,
        runUp: false,
        force: true,
        waitForClone: false
      })
    );
  });
  await Effect.runPromise(Effect.provide(program, NodeContext.layer));
  await runComposeWithLogs(projectDir, ["--progress", "plain", "build"], socket, "docker compose --progress plain build");
  await runComposeWithLogs(projectDir, ["up", "-d"], socket, "docker compose up -d");
};

const runComposeLogsFollow = (projectDir, socket) => {
  sendMessage(socket, { type: "info", data: "[recreate] docker compose logs --follow --tail 0" });
  const child = spawn("docker", ["compose", "logs", "--follow", "--tail", "0"], {
    cwd: projectDir,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (data) => {
    sendMessage(socket, { type: "output", data: data.toString("utf8") });
  });
  child.stderr.on("data", (data) => {
    sendMessage(socket, { type: "output", data: data.toString("utf8") });
  });
  return child;
};

const stopComposeLogsFollow = (child) => {
  if (!child || child.killed) {
    return;
  }
  child.kill("SIGINT");
};

const postRecreateStatus = async (projectId, phase, message) => {
  const base = process.env.WEB_BASE_URL ?? "http://localhost:3000";
  try {
    await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/recreate/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phase, message })
    });
  } catch {
    // Ignore status update failures; terminal output is source of truth.
  }
};

const connectSshWithRetry = async (config, socket, retries = 30, delayMs = 2000) => {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const client = await new Promise((resolve, reject) => {
        const next = new Client();
        const privateKey = fs.readFileSync(config.keyPath);
        next.on("ready", () => resolve(next));
        next.on("error", reject);
        next.connect({
          host: "localhost",
          port: config.sshPort,
          username: config.sshUser,
          privateKey,
          readyTimeout: 15000,
          hostHash: "sha256",
          hostVerifier: () => true
        });
      });
      return client;
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      sendMessage(socket, {
        type: "info",
        data: `[recreate] waiting for SSH (${attempt}/${retries})...`
      });
      await sleep(delayMs);
    }
  }
  throw new Error("SSH connection failed");
};

const startSshSession = async (projectDir) => {
  const config = readProjectTemplate(projectDir);
  await runComposeUp(projectDir);
  const keyPath = findKeyPath(projectDir);

  return {
    sshUser: config.sshUser ?? "dev",
    sshPort: Number(config.sshPort ?? 2222),
    keyPath,
    displayName: config.repoUrl ? config.repoUrl.split("/").slice(-2).join("/") : projectDir
  };
};

const server = createServer((_req, res) => {
  res.writeHead(200);
  res.end("docker-git terminal ws");
});

const wss = new WebSocketServer({ server, path: "/terminal" });

wss.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    return;
  }
  console.error("[terminal-ws] websocket error", error);
});

wss.on("connection", (socket, request) => {
  const requestUrl = request.url ?? "";
  const url = new URL(requestUrl, "http://localhost");
  const projectId = url.searchParams.get("projectId");
  const sessionId = url.searchParams.get("sessionId") ?? nextSessionId();
  const source = url.searchParams.get("source") ?? "web";
  const mode = url.searchParams.get("mode") === "recreate" ? "recreate" : "default";

  if (!projectId) {
    sendMessage(socket, { type: "error", data: "projectId is required" });
    socket.close();
    return;
  }

  registerSession({
    id: sessionId,
    projectId,
    displayName: projectId,
    mode,
    source,
    status: "connecting",
    connectedAt: nowIso()
  });

  sendMessage(socket, { type: "info", data: "[docker-git] connecting terminal…" });

  const attachShell = (client, displayName) => {
    updateSession(sessionId, { status: "connected", displayName });
    sendMessage(socket, { type: "info", data: `[docker-git] attached to ${displayName}` });

    client.shell(
      {
        term: "xterm-256color",
        cols: 120,
        rows: 32
      },
      (error, stream) => {
        if (error) {
          sendMessage(socket, { type: "error", data: String(error) });
          socket.close();
          client.end();
          return;
        }

        stream.on("data", (data) => {
          sendMessage(socket, { type: "output", data: data.toString("utf8") });
        });

        stream.stderr.on("data", (data) => {
          sendMessage(socket, { type: "output", data: data.toString("utf8") });
        });

        socket.on("message", (payload) => {
          const raw = typeof payload === "string" ? payload : payload.toString("utf8");
          const command = decodeMessage(raw);
          if (!command) {
            return;
          }
          if (command.type === "input") {
            stream.write(command.data);
          }
          if (command.type === "resize") {
            stream.setWindow(command.rows, command.cols, 0, 0);
          }
        });

        socket.on("close", () => {
          stream.close();
          client.end();
          removeSession(sessionId);
        });

        socket.on("error", () => {
          stream.close();
          client.end();
          removeSession(sessionId);
        });
      }
    );
  };

  const attachError = (error) => {
    sendMessage(socket, { type: "error", data: String(error) });
    socket.close();
    removeSession(sessionId);
  };

  const connectWithMode = async () => {
    if (mode === "recreate") {
      sendMessage(socket, { type: "info", data: "[recreate] mode=on" });
      void postRecreateStatus(projectId, "running", "Recreate started");
      sendMessage(socket, { type: "info", data: "[recreate] starting..." });
      const config = readProjectTemplate(projectId);
      const keyPath = findKeyPath(projectId);
      let logsChild = null;
      try {
        await runRecreateFlow(projectId, socket);
        logsChild = runComposeLogsFollow(projectId, socket);
        void postRecreateStatus(projectId, "success", "Recreate completed");
      } catch (error) {
        void postRecreateStatus(projectId, "error", String(error));
        throw error;
      }
      let client;
      try {
        client = await connectSshWithRetry(
          {
            sshUser: config.sshUser ?? "dev",
            sshPort: Number(config.sshPort ?? 2222),
            keyPath
          },
          socket
        );
      } finally {
        stopComposeLogsFollow(logsChild);
      }
      attachShell(client, config.repoUrl ? config.repoUrl.split("/").slice(-2).join("/") : projectId);
      return;
    }
    sendMessage(socket, { type: "info", data: "[terminal] mode=default" });
    const { sshUser, sshPort, keyPath, displayName } = await startSshSession(projectId);
    const client = new Client();
    const privateKey = fs.readFileSync(keyPath);
    client.on("ready", () => attachShell(client, displayName));
    client.on("error", attachError);
    client.connect({
      host: "localhost",
      port: sshPort,
      username: sshUser,
      privateKey,
      readyTimeout: 15000,
      hostHash: "sha256",
      hostVerifier: () => true
    });
  };

  connectWithMode()
    .catch((error) => {
      sendMessage(socket, { type: "error", data: String(error) });
      socket.close();
      removeSession(sessionId);
    });
});

const writeInfo = (port) => {
  const payload = {
    port,
    host: "localhost",
    path: "/terminal",
    startedAt: new Date().toISOString()
  };
  fs.writeFileSync(infoFile, JSON.stringify(payload, null, 2));
};

const tryListen = (port, attempt = 0) => {
  server.once("error", (error) => {
    if (error?.code === "EADDRINUSE" && attempt < maxAttempts) {
      const nextPort = port + 1;
      console.warn(`[terminal-ws] port ${port} in use, retrying on ${nextPort}`);
      tryListen(nextPort, attempt + 1);
      return;
    }
    console.error("[terminal-ws] failed to start", error);
    process.exit(1);
  });

  server.listen(port, () => {
    writeInfo(port);
    console.log(`docker-git terminal ws listening on ws://localhost:${port}/terminal`);
  });
};

tryListen(basePort);
