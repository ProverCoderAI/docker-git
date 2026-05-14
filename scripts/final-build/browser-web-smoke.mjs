import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("../..", import.meta.url))
const requestTimeoutMs = 5000
const startupTimeoutMs = 15000

const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve(server.address().port)
    })
  })

const closeServer = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve()
        return
      }
      reject(error)
    })
  })

const delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const fetchText = async (url) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, requestTimeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    const body = await response.text()
    return { body, status: response.status }
  } finally {
    clearTimeout(timeout)
  }
}

const waitForText = async (url, predicate) => {
  const startedAt = Date.now()
  let lastError = null
  while (Date.now() - startedAt < startupTimeoutMs) {
    try {
      const response = await fetchText(url)
      if (predicate(response)) {
        return response
      }
      lastError = new Error(`Unexpected response ${response.status} from ${url}: ${response.body.slice(0, 160)}`)
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`)
}

const createApiServer = () =>
  createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" })
      response.end(JSON.stringify({
        cwd: "/tmp/docker-git-final-build-smoke",
        ok: true,
        projectsRoot: "/tmp/docker-git-final-build-smoke/projects",
        revision: "final-build-smoke"
      }))
      return
    }
    if (request.url === "/federation/status") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" })
      response.end(JSON.stringify({
        publicActor: "https://docker-git.example/federation/actor",
        recentEvents: [],
        subscriptions: [],
        summary: {
          accepted: 0,
          issues: 0,
          pending: 0,
          processedOutboxItems: 0,
          rejected: 0,
          subscriptions: 0
        }
      }))
      return
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
    response.end("not found")
  })

const waitForExit = (child) =>
  new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      resolve({ code, signal })
    })
  })

const terminate = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  child.kill()
  const result = await Promise.race([
    waitForExit(child),
    delay(3000).then(() => null)
  ])
  if (result === null) {
    child.kill("SIGKILL")
    await waitForExit(child)
  }
}

const main = async () => {
  const apiServer = createApiServer()
  const apiPort = await listen(apiServer)
  const webPortServer = createServer()
  const webPort = await listen(webPortServer)
  await closeServer(webPortServer)

  const statePath = join(tmpdir(), `docker-git-web-smoke-${process.pid}.json`)
  const child = spawn(process.execPath, ["packages/app/scripts/serve-dist-web.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DOCKER_GIT_API_URL: `http://127.0.0.1:${apiPort}`,
      DOCKER_GIT_WEB_HOST: "127.0.0.1",
      DOCKER_GIT_WEB_PORT: String(webPort),
      DOCKER_GIT_WEB_REVISION: "final-build-smoke",
      DOCKER_GIT_WEB_STATE_PATH: statePath
    },
    stdio: ["ignore", "pipe", "pipe"]
  })

  let stdout = ""
  let stderr = ""
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk) => {
    stdout += chunk
  })
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })

  try {
    await waitForText(
      `http://127.0.0.1:${webPort}/`,
      ({ body, status }) => status === 200 && body.includes("<title>docker-git browser</title>")
    )
    await waitForText(
      `http://127.0.0.1:${webPort}/api/health`,
      ({ body, status }) => status === 200 && body.includes("\"ok\":true")
    )
    await waitForText(
      `http://127.0.0.1:${webPort}/federation/status`,
      ({ body, status }) => status === 200 && body.includes("\"publicActor\"")
    )
    console.log("browser web smoke passed")
  } catch (error) {
    console.error(stdout)
    console.error(stderr)
    throw error
  } finally {
    await terminate(child)
    await closeServer(apiServer)
  }
}

await main()
