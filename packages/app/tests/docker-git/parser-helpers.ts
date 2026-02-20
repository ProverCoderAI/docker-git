import { expect } from "@effect/vitest"
import { Effect, Either } from "effect"

import type { Command } from "@effect-template/lib/core/domain"
import { parseArgs } from "../../src/docker-git/cli/parser.js"

export type CreateCommand = Extract<Command, { _tag: "Create" }>
type ProjectDirRunUpCommand = Extract<Command, { readonly projectDir: string; readonly runUp: boolean }>

export const expectParseErrorTag = (
  args: ReadonlyArray<string>,
  expectedTag: string
) =>
  Effect.sync(() => {
    const parsed = parseArgs(args)
    Either.match(parsed, {
      onLeft: (error) => {
        expect(error._tag).toBe(expectedTag)
      },
      onRight: () => {
        throw new Error("expected parse error")
      }
    })
  })

export const parseOrThrow = (args: ReadonlyArray<string>): Command => {
  const parsed = parseArgs(args)
  return Either.match(parsed, {
    onLeft: (error) => {
      throw new Error(`unexpected error ${error._tag}`)
    },
    onRight: (command) => command
  })
}

export const expectProjectDirRunUpCommand = (
  args: ReadonlyArray<string>,
  expectedTag: ProjectDirRunUpCommand["_tag"],
  expectedProjectDir: string,
  expectedRunUp: boolean
) =>
  Effect.sync(() => {
    const command = parseOrThrow(args)
    if (command._tag !== expectedTag) {
      throw new Error(`expected ${expectedTag} command`)
    }
    if (!("projectDir" in command) || !("runUp" in command)) {
      throw new Error("expected command with projectDir and runUp")
    }
    expect(command.projectDir).toBe(expectedProjectDir)
    expect(command.runUp).toBe(expectedRunUp)
  })

export const expectAttachProjectDirCommand = (
  args: ReadonlyArray<string>,
  expectedProjectDir: string
) =>
  Effect.sync(() => {
    const command = parseOrThrow(args)
    if (command._tag !== "Attach") {
      throw new Error("expected Attach command")
    }
    expect(command.projectDir).toBe(expectedProjectDir)
  })

export const expectCreateCommand = (
  args: ReadonlyArray<string>,
  onRight: (command: CreateCommand) => void
) =>
  Effect.sync(() => {
    const command = parseOrThrow(args)
    if (command._tag !== "Create") {
      throw new Error("expected Create command")
    }
    onRight(command)
  })
