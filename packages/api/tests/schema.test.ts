import { describe, expect, it } from "@effect/vitest"
import { Effect, Either, ParseResult, Schema } from "effect"

import {
  ApplyAllRequestSchema,
  CodexAuthImportRequestSchema,
  CodexAuthLoginRequestSchema,
  CodexAuthLogoutRequestSchema,
  CreateAgentRequestSchema,
  CreateFollowRequestSchema,
  CreateProjectRequestSchema,
  GithubAuthLoginRequestSchema,
  GithubAuthLogoutRequestSchema,
  ProjectBrowserSessionSchema,
  StateCommitRequestSchema,
  StateInitRequestSchema,
  StateSyncRequestSchema,
  ProjectPortForwardRequestSchema,
  TerminalSessionSchema,
  UpProjectRequestSchema
} from "../src/api/schema.js"

describe("api schemas", () => {
  it.effect("decodes create project payload", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(CreateProjectRequestSchema)({
        repoUrl: "https://github.com/ProverCoderAI/docker-git",
        repoRef: "main",
        authorizedKeysContents: "ssh-ed25519 AAAA-test test@example\n",
        skipGithubAuth: true,
        up: true,
        force: false
      })

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (value) => {
          expect(value.repoRef).toBe("main")
          expect(value.authorizedKeysContents).toContain("ssh-ed25519")
          expect(value.skipGithubAuth).toBe(true)
          expect(value.up).toBe(true)
        }
      })
    }))

  it.effect("rejects invalid agent provider", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(CreateAgentRequestSchema)({
        provider: "wrong",
        command: "codex"
      })

      Either.match(result, {
        onLeft: (error) => {
          expect(ParseResult.TreeFormatter.formatIssueSync(error.issue)).toContain("Expected \"codex\"")
        },
        onRight: () => {
          throw new Error("Expected schema decode failure")
        }
      })
    }))

  it.effect("decodes follow payload", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(CreateFollowRequestSchema)({
        domain: "social.my-domain.tld",
        object: "/issues/followers",
        to: ["https://www.w3.org/ns/activitystreams#Public"]
      })

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (value) => {
          expect(value.actor).toBeUndefined()
          expect(value.domain).toBe("social.my-domain.tld")
          expect(value.object).toBe("/issues/followers")
          expect(value.to).toHaveLength(1)
        }
      })
    }))

  it.effect("decodes auth login payload", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(GithubAuthLoginRequestSchema)({
        label: "default",
        token: "token",
        scopes: "repo,workflow"
      })

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (value) => {
          expect(value.label).toBe("default")
          expect(value.token).toBe("token")
          expect(value.scopes).toBe("repo,workflow")
        }
      })
    }))

  it.effect("decodes codex auth import payload", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(CodexAuthImportRequestSchema)({
        label: "team-a",
        authText: JSON.stringify({ openai: { type: "api", key: "test" } })
      })

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (value) => {
          expect(value.label).toBe("team-a")
          expect(value.authText).toContain('"key":"test"')
        }
      })
    }))

  it.effect("decodes codex auth login payload", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(CodexAuthLoginRequestSchema)({
        label: "team-a"
      })

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (value) => {
          expect(value.label).toBe("team-a")
        }
      })
    }))

  it.effect("decodes codex auth logout payload", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(CodexAuthLogoutRequestSchema)({
        label: "team-a"
      })

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (value) => {
          expect(value.label).toBe("team-a")
        }
      })
    }))

  it.effect("decodes auth logout payload", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(GithubAuthLogoutRequestSchema)({
        label: "default"
      })

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (value) => {
          expect(value.label).toBe("default")
        }
      })
    }))

  it.effect("decodes apply-all payload", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(ApplyAllRequestSchema)({
        activeOnly: true
      })

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (value) => {
          expect(value.activeOnly).toBe(true)
        }
      })
    }))

  it.effect("decodes state init payload", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(StateInitRequestSchema)({
        repoUrl: "https://github.com/org/.docker-git.git",
        repoRef: "main"
      })

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (value) => {
          expect(value.repoUrl).toBe("https://github.com/org/.docker-git.git")
          expect(value.repoRef).toBe("main")
        }
      })
    }))

  it.effect("decodes state commit payload", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(StateCommitRequestSchema)({
        message: "chore(state): sync"
      })

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (value) => {
          expect(value.message).toBe("chore(state): sync")
        }
      })
    }))

  it.effect("decodes state sync payload", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(StateSyncRequestSchema)({
        message: null
      })

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (value) => {
          expect(value.message).toBeNull()
        }
      })
    }))

  it.effect("decodes up-project payload", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(UpProjectRequestSchema)({
        authorizedKeysContents: "ssh-ed25519 AAAA-test test@example\n"
      })

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (value) => {
          expect(value.authorizedKeysContents).toContain("ssh-ed25519")
        }
      })
    }))

  it.effect("decodes project port forward payload", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(ProjectPortForwardRequestSchema)({
        hostPort: 4000,
        targetPort: 3000
      })

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (value) => {
          expect(value.hostPort).toBe(4000)
          expect(value.targetPort).toBe(3000)
        }
      })
    }))

  it.effect("decodes project browser session payload", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(ProjectBrowserSessionSchema)({
        cdpPath: "/b/abc123abc123/cdp/json/version",
        cdpUrl: "https://docker-git.example.test/b/abc123abc123/cdp/json/version",
        containerName: "dg-project-browser",
        noVncPath: "/b/abc123abc123/vnc.html?autoconnect=true",
        noVncUrl: "https://docker-git.example.test/b/abc123abc123/vnc.html?autoconnect=true",
        projectId: "project-1",
        projectKey: "abc123abc123",
        status: "running"
      })

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (value) => {
          expect(value.status).toBe("running")
          expect(value.containerName).toBe("dg-project-browser")
        }
      })
    }))

  it.effect("decodes terminal session payload", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(TerminalSessionSchema)({
        id: "session-1",
        projectId: "project-1",
        sshCommand: "ssh dev@127.0.0.1",
        status: "attached",
        createdAt: "2026-04-08T10:00:00.000Z",
        startedAt: "2026-04-08T10:00:01.000Z",
        exitCode: 0
      })

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (value) => {
          expect(value.id).toBe("session-1")
          expect(value.projectId).toBe("project-1")
          expect(value.status).toBe("attached")
          expect(value.exitCode).toBe(0)
          expect(value.signal).toBeUndefined()
        }
      })
    }))
})
