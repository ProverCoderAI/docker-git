import * as ParseResult from "@effect/schema/ParseResult"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Either } from "effect"

import {
  TerminalClientMessageSchema,
  type TerminalServerMessage,
  TerminalServerMessageSchema,
  TerminalSessionSchema
} from "../../src/contracts/index.js"

const readyMessage: TerminalServerMessage = {
  session: {
    createdAt: "2026-04-08T10:00:00.000Z",
    id: "session-1",
    projectId: "project-1",
    sshCommand: "ssh dev@127.0.0.1",
    status: "attached"
  },
  type: "ready"
}

describe("terminal contracts", () => {
  it.effect("decodes terminal session payloads", () =>
    Effect.sync(() => {
      const result = ParseResult.decodeUnknownEither(TerminalSessionSchema)(readyMessage.session)

      expect(Either.isRight(result)).toBe(true)
    }))

  it.effect("decodes JSON server messages", () =>
    Effect.sync(() => {
      const result = ParseResult.decodeUnknownEither(TerminalServerMessageSchema)(JSON.stringify(readyMessage))

      expect(Either.getOrNull(result)).toEqual(readyMessage)
    }))

  it.effect("rejects malformed server messages", () =>
    Effect.sync(() => {
      const result = ParseResult.decodeUnknownEither(TerminalServerMessageSchema)("{\"type\":\"output\",\"data\":1}")

      expect(Either.isLeft(result)).toBe(true)
    }))

  it.effect("decodes client input, resize, image, and close messages", () =>
    Effect.sync(() => {
      const messages = [
        { type: "input", data: "ls\n" },
        { type: "resize", cols: 120, rows: 40 },
        { type: "image", data: "aGVsbG8=", mediaType: "image/png", name: "hello.png", size: 5 },
        { type: "close" }
      ].map((message) => JSON.stringify(message))

      expect(
        messages.every((message) =>
          Either.isRight(ParseResult.decodeUnknownEither(TerminalClientMessageSchema)(message))
        )
      ).toBe(true)
    }))
})
