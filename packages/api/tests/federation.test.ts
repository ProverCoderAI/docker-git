import { Person } from "@fedify/vocab"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import fc from "fast-check"
import { vi } from "vitest"

import {
  activityForgeFedJsonLdContext,
  federationJsonLdContentType
} from "../src/api/contracts.js"
import {
  makeFedifyActorJsonLd,
  makeFedifyFollowingJsonLd
} from "../src/services/fedify-federation.js"
import {
  clearFederationState,
  createFollowSubscription,
  ensureExchangeSubscription,
  ingestFederationInbox,
  listFederationIssues,
  listExchangeSubscriptions,
  listFollowSubscriptions,
  makeFederationContext,
  makeFederationExchangeStatus,
  pollExchangeOutboxes
} from "../src/services/federation.js"

type JsonRecord = Record<string, unknown>

const isJsonRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const asRecord = (value: unknown): JsonRecord => {
  if (!isJsonRecord(value)) {
    throw new Error("Expected JSON object.")
  }
  return value
}

const readField = (record: JsonRecord, key: string): unknown =>
  Reflect.get(record, key)

const countKey = (value: unknown, key: string): number => {
  if (Array.isArray(value)) {
    return value.reduce((count, item) => count + countKey(item, key), 0)
  }
  if (!isJsonRecord(value)) {
    return 0
  }
  const current = Reflect.has(value, key) ? 1 : 0
  return Object.values(value).reduce<number>((count, item) => count + countKey(item, key), current)
}

const actorUsernameArbitrary = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((value) => /^[a-z0-9_-]+$/i.test(value))

const publicOriginArbitrary = fc.webUrl().map((value) => new URL(value).origin)

const parsePersonJsonLd = (payload: unknown) =>
  Effect.tryPromise({
    try: () => Person.fromJsonLd(payload),
    catch: (cause) => cause instanceof Error ? cause : new Error(String(cause))
  })

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
      expect(created.activity["@context"]).toEqual(activityForgeFedJsonLdContext)
      expect(created.activity.id).toContain("https://social.provercoder.ai/federation/activities/follows/")
      expect(created.activity.actor).toBe("https://social.provercoder.ai/federation/actor")

      const accepted = yield* _(
        ingestFederationInbox({
          "@context": activityForgeFedJsonLdContext,
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

  it.effect("builds person and following collections through Fedify", () =>
    Effect.gen(function*(_) {
      clearFederationState()

      const context = yield* _(
        makeFederationContext({
          publicOrigin: "https://social.provercoder.ai",
          actorUsername: "tasks"
        })
      )

      const person = asRecord(yield* _(makeFedifyActorJsonLd(context)))
      expect(readField(person, "type")).toBe("Person")
      expect(readField(person, "id")).toBe("https://social.provercoder.ai/federation/actor")
      expect(readField(person, "preferredUsername")).toBe("tasks")
      expect(readField(person, "followers")).toBe("https://social.provercoder.ai/federation/followers")

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
          "@context": activityForgeFedJsonLdContext,
          type: "Accept",
          object: created.activity.id
        })
      )

      const following = asRecord(yield* _(makeFedifyFollowingJsonLd(context)))
      expect(readField(following, "type")).toBe("OrderedCollection")
      expect(readField(following, "totalItems")).toBe(1)
      expect(readField(following, "orderedItems")).toEqual([
        "https://tracker.provercoder.ai/issues/followers"
      ])
    }))

  it.effect("satisfies Fedify actor JSON-LD property invariants", () =>
    Effect.tryPromise({
      try: () =>
        fc.assert(
          fc.asyncProperty(
            fc.record({
              publicOrigin: publicOriginArbitrary,
              actorUsername: actorUsernameArbitrary
            }),
            ({ publicOrigin, actorUsername }) =>
              Effect.runPromise(
                Effect.gen(function*(_) {
                  yield* _(Effect.sync(() => clearFederationState()))
                  const context = yield* _(
                    makeFederationContext({ publicOrigin, actorUsername })
                  )
                  const payload = yield* _(makeFedifyActorJsonLd(context))
                  const actor = asRecord(payload)
                  const parsed = yield* _(parsePersonJsonLd(payload))

                  expect(parsed.id?.href).toBe(`${context.publicOrigin}/federation/actor`)
                  expect(parsed.preferredUsername).toBe(context.actorUsername)
                  expect(countKey(actor, "@context")).toBe(1)
                  expect(readField(actor, "id")).toBe(`${context.publicOrigin}/federation/actor`)
                  expect(readField(actor, "inbox")).toBe(`${context.publicOrigin}/federation/inbox`)
                  expect(readField(actor, "outbox")).toBe(`${context.publicOrigin}/federation/outbox`)
                  expect(readField(actor, "followers")).toBe(`${context.publicOrigin}/federation/followers`)
                  expect(readField(actor, "following")).toBe(`${context.publicOrigin}/federation/following`)
                  expect(readField(actor, "liked")).toBe(`${context.publicOrigin}/federation/liked`)
                })
              )
          ),
          { numRuns: 10 }
        ),
      catch: (cause) => cause instanceof Error ? cause : new Error(String(cause))
    }))

  it.effect("satisfies Fedify following collection property invariants", () =>
    Effect.tryPromise({
      try: () =>
        fc.assert(
          fc.asyncProperty(
            fc.record({
              targetIds: fc.uniqueArray(fc.integer({ min: 1, max: 10_000 }), { maxLength: 5 })
            }),
            ({ targetIds }) =>
              Effect.runPromise(
                Effect.gen(function*(_) {
                  yield* _(Effect.sync(() => clearFederationState()))
                  const context = yield* _(
                    makeFederationContext({
                      publicOrigin: "https://social.provercoder.ai",
                      actorUsername: "tasks"
                    })
                  )

                  yield* _(
                    Effect.forEach(
                      targetIds,
                      (targetId) =>
                        Effect.gen(function*(_) {
                          const created = yield* _(
                            createFollowSubscription(
                              {
                                object: `https://tracker${targetId}.example.test/issues/followers`
                              },
                              context
                            )
                          )
                          yield* _(
                            ingestFederationInbox({
                              "@context": activityForgeFedJsonLdContext,
                              type: "Accept",
                              object: created.activity.id
                            })
                          )
                        }),
                      { discard: true }
                    )
                  )

                  const payload = yield* _(makeFedifyFollowingJsonLd(context))
                  const following = asRecord(payload)
                  const orderedItems = readField(following, "orderedItems")
                  const items = Array.isArray(orderedItems) ? orderedItems : []

                  expect(readField(following, "id")).toBe(`${context.publicOrigin}/federation/following`)
                  expect(readField(following, "totalItems")).toBe(items.length)
                  expect(countKey(following, "@context")).toBe(1)
                })
              )
          ),
          { numRuns: 10 }
        ),
      catch: (cause) => cause instanceof Error ? cause : new Error(String(cause))
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

  it.effect("rejects federation inbox payloads without JSON-LD ForgeFed context", () =>
    Effect.gen(function*(_) {
      clearFederationState()

      const missingContext = yield* _(
        ingestFederationInbox({
          id: "https://tracker.example/offers/42",
          type: "Offer",
          object: {
            type: "Ticket",
            id: "https://tracker.example/issues/42",
            attributedTo: "https://origin.example/users/alice",
            summary: "Need context",
            content: "Missing JSON-LD context."
          }
        }).pipe(Effect.flip)
      )

      const missingForgeFed = yield* _(
        ingestFederationInbox({
          "@context": "https://www.w3.org/ns/activitystreams",
          id: "https://tracker.example/offers/43",
          type: "Offer",
          object: {
            type: "Ticket",
            id: "https://tracker.example/issues/43",
            attributedTo: "https://origin.example/users/alice",
            summary: "Need ForgeFed context",
            content: "Missing ForgeFed JSON-LD context."
          }
        }).pipe(Effect.flip)
      )

      expect(missingContext._tag).toBe("ApiBadRequestError")
      expect(missingContext.message).toContain("JSON-LD @context")
      expect(missingForgeFed._tag).toBe("ApiBadRequestError")
      expect(missingForgeFed.message).toContain("ForgeFed")
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
        expect(created.activity["@context"]).toEqual(activityForgeFedJsonLdContext)
        expect(listExchangeSubscriptions()).toHaveLength(1)

        const followPost = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")
        expect(followPost?.[1]?.headers).toMatchObject({
          "content-type": federationJsonLdContentType
        })

        const pendingStatus = makeFederationExchangeStatus(context)
        expect(pendingStatus.summary.pending).toBe(1)
        expect(pendingStatus.recentEvents.map((event) => event.kind)).toContain("follow.sent")

        yield* _(
          ingestFederationInbox({
            "@context": activityForgeFedJsonLdContext,
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
            "@context": activityForgeFedJsonLdContext,
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
