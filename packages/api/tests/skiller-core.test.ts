import { describe, expect, it } from "@effect/vitest"

import {
  configuredSkillerWebCorsOrigins,
  containerCodexSkillsPath,
  externalSkillerLaunchUrl,
  isSkillerWebCorsOriginAllowed,
  parseDockerMountLines,
  remapContainerPathToMountedHost,
  remapSkillerBrowserContainerPath,
  remapSkillerBrowserHostPath,
  resolveConfiguredSkillerWebUrl,
  resolveDockerGitSkillerBackendUrl,
  sameSkillerScope,
  skillerBrowserScopeForContainer
} from "../src/services/skiller-core.js"

describe("skiller container filesystem mapping", () => {
  it("resolves external Skiller web URLs from docker-git environment", () => {
    expect(resolveConfiguredSkillerWebUrl({})).toEqual({ _tag: "Disabled" })
    expect(resolveConfiguredSkillerWebUrl({ DOCKER_GIT_SKILLER_WEB_URL: "  " })).toEqual({ _tag: "Disabled" })
    expect(resolveConfiguredSkillerWebUrl({
      DOCKER_GIT_SKILLER_WEB_URL: "https://skiller.example/app/?ignored=1#hash"
    })).toEqual({
      _tag: "Enabled",
      baseUrl: "https://skiller.example/app"
    })
    expect(resolveConfiguredSkillerWebUrl({ DOCKER_GIT_SKILLER_WEB_URL: "file:///tmp/skiller" })._tag).toBe("Invalid")
  })

  it("builds external Skiller launch URLs with docker-git context parameters", () => {
    const launchUrl = new URL(externalSkillerLaunchUrl({
      backendUrl: "https://docker-git.example/api",
      projectKey: "project one",
      sessionId: "session/1",
      skillerWebUrl: "https://skiller.example/ui/"
    }))

    expect(launchUrl.origin).toBe("https://skiller.example")
    expect(launchUrl.pathname).toBe("/ui/launch")
    expect(launchUrl.searchParams.get("backendUrl")).toBe("https://docker-git.example/api")
    expect(launchUrl.searchParams.get("projectKey")).toBe("project one")
    expect(launchUrl.searchParams.get("sessionId")).toBe("session/1")
  })

  it("prefers explicit Skiller backend URLs before request origin", () => {
    expect(resolveDockerGitSkillerBackendUrl({
      DOCKER_GIT_API_PUBLIC_URL: "https://public-api.example",
      DOCKER_GIT_SKILLER_BACKEND_URL: "https://skiller-backend.example"
    }, "http://localhost:3334")).toBe("https://skiller-backend.example")

    expect(resolveDockerGitSkillerBackendUrl({
      DOCKER_GIT_API_PUBLIC_URL: " https://public-api.example "
    }, "http://localhost:3334")).toBe("https://public-api.example")

    expect(resolveDockerGitSkillerBackendUrl({}, "http://localhost:3334")).toBe("http://localhost:3334")
  })

  it("allows Skiller Web CORS only from configured exact origins and local dev", () => {
    const env = {
      DOCKER_GIT_SKILLER_ALLOWED_ORIGINS: "https://preview.example/app, file:///tmp/ignored",
      DOCKER_GIT_SKILLER_WEB_URL: "https://skiller.example/ui"
    }

    expect(configuredSkillerWebCorsOrigins(env)).toEqual([
      "https://skiller.example",
      "https://preview.example",
      "https://skiller-web-henna.vercel.app",
      "http://localhost:5180",
      "http://127.0.0.1:5180"
    ])
    expect(isSkillerWebCorsOriginAllowed("https://skiller.example", env)).toBe(true)
    expect(isSkillerWebCorsOriginAllowed("https://preview.example", env)).toBe(true)
    expect(isSkillerWebCorsOriginAllowed("https://skiller-web-henna.vercel.app", env)).toBe(true)
    expect(isSkillerWebCorsOriginAllowed("https://preview.example.evil", env)).toBe(false)
    expect(isSkillerWebCorsOriginAllowed(undefined, env)).toBe(false)
  })

  it("maps a project container path through the most specific writable Docker mount", () => {
    const mounts = parseDockerMountLines([
      "/var/lib/docker/volumes/project-home/_data\t/home/dev\ttrue",
      "/var/lib/docker/volumes/project-cache/_data\t/home/dev/.docker-git/.cache\ttrue",
      "/bootstrap\t/opt/docker-git/bootstrap/source\tfalse"
    ].join("\n"))

    expect(remapContainerPathToMountedHost(mounts, "/home/dev/app")).toBe(
      "/var/lib/docker/volumes/project-home/_data/app"
    )
    expect(remapContainerPathToMountedHost(mounts, containerCodexSkillsPath("/home/dev"))).toBe(
      "/var/lib/docker/volumes/project-home/_data/.codex/skills"
    )
    expect(remapContainerPathToMountedHost(mounts, "/home/dev/.docker-git/.cache/bun")).toBe(
      "/var/lib/docker/volumes/project-cache/_data/bun"
    )
    expect(remapContainerPathToMountedHost(mounts, "/opt/docker-git/bootstrap/source")).toBeNull()
  })

  it("treats identical Skiller scopes as reusable and different scopes as isolated", () => {
    const scope = {
      containerCodexSkillsPath: "/home/dev/.codex/skills",
      containerHomePath: "/home/dev",
      containerName: "dg-project",
      containerProjectPath: "/home/dev/app",
      hostCodexSkillsPath: "/var/lib/docker/volumes/project-home/_data/.codex/skills",
      hostEnvGlobalPath: "/home/dev/.docker-git/project/.docker-git/.orch/env/global.env",
      hostHomePath: "/var/lib/docker/volumes/project-home/_data",
      hostProjectPath: "/var/lib/docker/volumes/project-home/_data/app",
      projectId: "/home/dev/.docker-git/project",
      projectKey: "abc123",
      sshUser: "dev"
    }

    expect(sameSkillerScope(scope, scope)).toBe(true)
    expect(sameSkillerScope(scope, { ...scope, projectKey: "def456" })).toBe(false)
    expect(sameSkillerScope(scope, {
      ...scope,
      hostCodexSkillsPath: "/var/lib/docker/volumes/other-home/_data/.codex/skills"
    })).toBe(false)
    expect(sameSkillerScope(scope, null)).toBe(false)
    expect(sameSkillerScope(null, null)).toBe(true)
  })

  it("builds a browser picker scope that remaps selected container paths to host volume paths", () => {
    const browserScope = skillerBrowserScopeForContainer({
      containerCodexSkillsPath: "/home/dev/.codex/skills",
      containerHomePath: "/home/dev",
      containerName: "dg-project",
      containerProjectPath: "/home/dev/app",
      hostCodexSkillsPath: "/var/lib/docker/volumes/project-home/_data/.codex/skills",
      hostEnvGlobalPath: "/home/dev/.docker-git/project/.docker-git/.orch/env/global.env",
      hostHomePath: "/var/lib/docker/volumes/project-home/_data",
      hostProjectPath: "/var/lib/docker/volumes/project-home/_data/app",
      projectId: "/home/dev/.docker-git/project",
      projectKey: "abc123",
      sshUser: "dev"
    }, "terminal-session")

    expect(skillerBrowserScopeForContainer({
      containerCodexSkillsPath: "/home/dev/.codex/skills",
      containerHomePath: "/home/dev",
      containerName: "dg-project",
      containerProjectPath: "/home/dev/app",
      hostCodexSkillsPath: "/var/lib/docker/volumes/project-home/_data/.codex/skills",
      hostEnvGlobalPath: "/home/dev/.docker-git/project/.docker-git/.orch/env/global.env",
      hostHomePath: "/var/lib/docker/volumes/project-home/_data",
      hostProjectPath: "/var/lib/docker/volumes/project-home/_data/app",
      projectId: "/home/dev/.docker-git/project",
      projectKey: "abc123",
      sshUser: "dev"
    }, null).sessionId).toBeNull()
    expect(browserScope.currentProject.containerPath).toBe("/home/dev/app")
    expect(remapSkillerBrowserContainerPath(browserScope, "/home/dev/app/packages")).toBe(
      "/var/lib/docker/volumes/project-home/_data/app/packages"
    )
    expect(remapSkillerBrowserContainerPath(browserScope, "/home/dev/.codex/skills/demo")).toBe(
      "/var/lib/docker/volumes/project-home/_data/.codex/skills/demo"
    )
    expect(remapSkillerBrowserContainerPath(browserScope, "/tmp/outside")).toBeNull()
    expect(remapSkillerBrowserHostPath(
      browserScope,
      "/var/lib/docker/volumes/project-home/_data/app/packages"
    )).toBe("/home/dev/app/packages")
  })
})
