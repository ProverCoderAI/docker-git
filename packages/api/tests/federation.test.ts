import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import {
  clearFederationState,
  createFollowSubscription,
  ingestFederationInbox,
  listFederationIssues,
  listFollowSubscriptions,
  makeFederationActorDocument,
  makeFederationContext,
  makeFederationFollowingCollection
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
})
