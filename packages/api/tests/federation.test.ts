import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { vi } from "vitest"

import {
  clearFederationState,
  createFollowSubscription,
  ensureExchangeSubscription,
  ingestFederationInbox,
  listFederationIssues,
  listExchangeSubscriptions,
  listFollowSubscriptions,
  makeFederationActorDocument,
  makeFederationContext,
  makeFederationExchangeStatus,
  makeFederationFollowingCollection,
  pollExchangeOutboxes
} from "../src/services/federation.js"

describe("federation service", () => {
  it.effect("ingests ForgeFed Offer with Ticket payload", () =>
    Effect.gen(function*(_) {
      clearFederationState()

      const result = yield* _(
        ingestFederationInbox({
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            "https://forgefed.org/ns"
          ],
          id: "https://tracker.example/offers/42",
          type: "Offer",
          target: "https://tracker.example/issues",
          object: {
            type: "Ticket",
            id: "https://tracker.example/issues/42",
            attributedTo: "https://origin.example/users/alice",
            summary: "Need reproducible CI parity",
            content: "Implement API behavior matching CLI."
          }
        })
      )

      expect(result.kind).toBe("issue.offer")
      if (result.kind === "issue.offer") {
        expect(result.issue.issueId).toBe("https://tracker.example/issues/42")
        expect(result.issue.status).toBe("offered")
      }

      const issues = listFederationIssues()
      expect(issues).toHaveLength(1)
      expect(issues[0]?.tracker).toBe("https://tracker.example/issues")
    }))

  it.effect("creates follow subscription and resolves it via Accept activity", () =>
    Effect.gen(function*(_) {
      clearFederationState()

      const context = yield* _(
        makeFederationContext({
          publicOrigin: "https://social.provercoder.ai",
          actorUsername: "docker-git"
        })
      )

      const created = yield* _(
        createFollowSubscription(
          {
            object: "https://tracker.provercoder.ai/issues/followers",
            capability: "https://tracker.provercoder.ai/caps/follow",
            to: ["https://www.w3.org/ns/activitystreams#Public"]
          },
          context
        )
      )

      expect(created.subscription.status).toBe("pending")
      expect(created.activity.type).toBe("Follow")
      expect(created.activity.id).toContain("https://social.provercoder.ai/federation/activities/follows/")
      expect(created.activity.actor).toBe("https://social.provercoder.ai/federation/actor")

      const accepted = yield* _(
        ingestFederationInbox({
          type: "Accept",
          actor: "https://tracker.example/system",
          object: created.activity.id
        })
      )

      expect(accepted.kind).toBe("follow.accept")
      if (accepted.kind === "follow.accept") {
        expect(accepted.subscription.status).toBe("accepted")
      }

      const follows = listFollowSubscriptions()
      expect(follows).toHaveLength(1)
      expect(follows[0]?.status).toBe("accepted")
    }))

  it.effect("replaces .example host by configured domain", () =>
    Effect.gen(function*(_) {
      clearFederationState()

      const context = yield* _(
        makeFederationContext({
          publicOrigin: "social.provercoder.ai"
        })
      )

      const created = yield* _(
        createFollowSubscription(
          {
            actor: "https://dev.example/users/bot",
            object: "https://tracker.example/issues/followers",
            inbox: "/federation/inbox"
          },
          context
        )
      )

      expect(created.activity.actor).toBe("https://social.provercoder.ai/users/bot")
      expect(created.activity.object).toBe("https://social.provercoder.ai/issues/followers")
      expect(created.subscription.inbox).toBe("https://social.provercoder.ai/federation/inbox")
    }))

  it.effect("builds person and following collections in activitypub shape", () =>
    Effect.gen(function*(_) {
      clearFederationState()

      const context = yield* _(
        makeFederationContext({
          publicOrigin: "https://social.provercoder.ai",
          actorUsername: "tasks"
        })
      )

      const person = makeFederationActorDocument(context)
      expect(person.type).toBe("Person")
      expect(person.id).toBe("https://social.provercoder.ai/federation/actor")
      expect(person.preferredUsername).toBe("tasks")
      expect(person.followers).toBe("https://social.provercoder.ai/federation/followers")

      const created = yield* _(
        createFollowSubscription(
          {
            object: "https://tracker.provercoder.ai/issues/followers"
          },
          context
        )
      )

      yield* _(
        ingestFederationInbox({
          type: "Accept",
          object: created.activity.id
        })
      )

      const following = makeFederationFollowingCollection(context)
      expect(following.type).toBe("OrderedCollection")
      expect(following.totalItems).toBe(1)
      expect(following.orderedItems[0]).toBe("https://tracker.provercoder.ai/issues/followers")
    }))

  it.effect("rejects duplicate pending follow subscription", () =>
    Effect.gen(function*(_) {
      clearFederationState()

      const context = yield* _(
        makeFederationContext({
          publicOrigin: "https://social.provercoder.ai"
        })
      )

      const request = {
        object: "https://tracker.provercoder.ai/issues/followers"
      } as const

      yield* _(createFollowSubscription(request, context))

      const duplicateError = yield* _(
        createFollowSubscription(request, context).pipe(Effect.flip)
      )

      expect(duplicateError._tag).toBe("ApiConflictError")
    }))

  it.effect("ingests ActivityPub Create with ForgeFed Ticket payload", () =>
    Effect.gen(function*(_) {
      clearFederationState()

      const result = yield* _(
        ingestFederationInbox({
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            "https://forgefed.org/ns"
          ],
          id: "https://exchange.lefine.pro/outbox/code/111",
          type: "Create",
          actor: "https://exchange.lefine.pro/actor/code",
          object: {
            "@context": [
              "https://www.w3.org/ns/activitystreams",
              "https://forgefed.org/ns"
            ],
            type: "Ticket",
            id: "https://exchange.lefine.pro/orders/111",
            attributedTo: "https://exchange.lefine.pro/actor/code",
            summary: "Calculate 2+2 via remote cogni",
            content: "<p>Calculate 2+2</p>",
            mediaType: "text/html",
            source: {
              content: "Calculate 2+2",
              mediaType: "text/plain"
            },
            workType: "standard"
          }
        })
      )

      expect(result.kind).toBe("issue.create")
      if (result.kind === "issue.create") {
        expect(result.issue.issueId).toBe("https://exchange.lefine.pro/orders/111")
        expect(result.issue.status).toBe("accepted")
        expect(result.issue.ticket.source).toEqual({
          content: "Calculate 2+2",
          mediaType: "text/plain"
        })
      }
    }))

  it.effect("discovers exchange root target and deduplicates polled Create tasks", () =>
    Effect.gen(function*(_) {
      clearFederationState()

      const previousFetch = globalThis.fetch
      const fetchMock = vi.fn((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
        const method = init?.method ?? "GET"

        if (method === "GET" && url === "https://exchange.lefine.pro/actor/code") {
          return Promise.resolve(new Response(JSON.stringify({
            "@context": ["https://www.w3.org/ns/activitystreams", "https://forgefed.org/ns"],
            id: "https://exchange.lefine.pro/actor/code",
            type: "Service",
            inbox: "https://exchange.lefine.pro/inbox/code",
            outbox: "https://exchange.lefine.pro/outbox/code",
            followers: "https://exchange.lefine.pro/actors/code/followers",
            preferredUsername: "code",
            publicKey: {
              id: "https://exchange.lefine.pro/actor/code#main-key",
              owner: "https://exchange.lefine.pro/actor/code",
              publicKeyPem: "pem"
            }
          }), { status: 200 }))
        }

        if (method === "GET" && url === "https://exchange.lefine.pro/outbox/code") {
          return Promise.resolve(new Response(JSON.stringify({
            "@context": ["https://www.w3.org/ns/activitystreams", "https://forgefed.org/ns"],
            id: "https://exchange.lefine.pro/outbox/code",
            type: "OrderedCollection",
            totalItems: 1,
            orderedItems: [
              {
                "@context": ["https://www.w3.org/ns/activitystreams", "https://forgefed.org/ns"],
                id: "https://exchange.lefine.pro/outbox/code/111",
                type: "Create",
                actor: "https://exchange.lefine.pro/actor/code",
                object: {
                  type: "Ticket",
                  id: "https://exchange.lefine.pro/orders/111",
                  attributedTo: "https://exchange.lefine.pro/actor/code",
                  summary: "Calculate 2+2",
                  content: "<p>Calculate 2+2</p>",
                  source: {
                    content: "Calculate 2+2",
                    mediaType: "text/plain"
                  }
                }
              }
            ]
          }), { status: 200 }))
        }

        return Promise.resolve(new Response("{}", { status: 202 }))
      })

      globalThis.fetch = fetchMock as typeof fetch

      try {
        const context = yield* _(
          makeFederationContext({
            publicOrigin: "https://docker-git.example",
            actorUsername: "docker-git"
          })
        )

        const created = yield* _(ensureExchangeSubscription({ target: "https://exchange.lefine.pro" }, context))
        expect(created.subscription.remoteOutbox).toBe("https://exchange.lefine.pro/outbox/code")
        expect(created.subscription.queue).toBe("code")
        expect(listExchangeSubscriptions()).toHaveLength(1)

        const pendingStatus = makeFederationExchangeStatus(context)
        expect(pendingStatus.summary.pending).toBe(1)
        expect(pendingStatus.recentEvents.map((event) => event.kind)).toContain("follow.sent")

        yield* _(
          ingestFederationInbox({
            type: "Accept",
            actor: "https://exchange.lefine.pro/actor/code",
            object: created.activity.id
          })
        )

        const acceptedStatus = makeFederationExchangeStatus(context)
        expect(acceptedStatus.summary.accepted).toBe(1)
        expect(acceptedStatus.summary.lastInboxAt).toBeDefined()
        expect(acceptedStatus.recentEvents.map((event) => event.kind)).toContain("inbox.follow.accept")

        const firstPoll = yield* _(pollExchangeOutboxes({ runTasks: false }, context))
        expect(firstPoll.newItems).toBe(1)
        expect(firstPoll.processedItems).toBe(1)

        const issues = listFederationIssues()
        expect(issues).toHaveLength(1)
        expect(issues[0]?.issueId).toBe("https://exchange.lefine.pro/orders/111")

        const polledStatus = makeFederationExchangeStatus(context)
        const polledEventKinds = polledStatus.recentEvents.map((event) => event.kind)
        expect(polledStatus.summary.issues).toBe(1)
        expect(polledStatus.summary.processedOutboxItems).toBe(1)
        expect(polledStatus.summary.lastPollAt).toBe(firstPoll.polledAt)
        expect(polledEventKinds).toContain("inbox.issue.received")
        expect(polledEventKinds).toContain("poll.completed")
        expect(polledStatus.recentEvents.find((event) => event.kind === "poll.completed")).toMatchObject({
          totalItems: 1,
          newItems: 1,
          processedItems: 1,
          failedItems: 0
        })

        const secondPoll = yield* _(pollExchangeOutboxes({ runTasks: false }, context))
        expect(secondPoll.newItems).toBe(0)
      } finally {
        globalThis.fetch = previousFetch
      }
    }))

  it.effect("bounds federation exchange event history", () =>
    Effect.gen(function*(_) {
      clearFederationState()

      const context = yield* _(
        makeFederationContext({
          publicOrigin: "https://social.provercoder.ai"
        })
      )

      for (let index = 0; index < 105; index += 1) {
        yield* _(
          ingestFederationInbox({
            type: "Ticket",
            id: `https://tracker.example/issues/${index}`,
            attributedTo: "https://origin.example/users/alice",
            summary: `Issue ${index}`,
            content: "Confirm bounded exchange event history."
          })
        )
      }

      const status = makeFederationExchangeStatus(context)
      expect(status.summary.issues).toBe(105)
      expect(status.recentEvents).toHaveLength(100)
      expect(status.recentEvents.map((event) => event.kind)).toContain("inbox.issue.received")
    }))
})
