// CHANGE: unit tests for isAutoPullEnabled env predicate
// WHY: ensure auto-pull can be controlled via DOCKER_GIT_STATE_AUTO_PULL env var
// QUOTE(ТЗ): "Сделать что бы когда вызывается команда docker-git то происходит git pull для .docker-git папки"
// REF: issue-178
// PURITY: CORE (pure predicate tests)
// INVARIANT: behaviour mirrors isAutoSyncEnabled — enabled by default when remote exists

import { describe, expect, it } from "@effect/vitest"
import { isAutoPullEnabled } from "../../../src/usecases/state-repo/env.js"

describe("isAutoPullEnabled", () => {
  it("returns true when env is undefined and remote exists", () => {
    expect(isAutoPullEnabled(undefined, true)).toBe(true)
  })

  it("returns false when env is undefined and no remote", () => {
    expect(isAutoPullEnabled(undefined, false)).toBe(false)
  })

  it("returns true when env is empty string and remote exists", () => {
    expect(isAutoPullEnabled("", true)).toBe(true)
  })

  it("returns false when env is empty string and no remote", () => {
    expect(isAutoPullEnabled("", false)).toBe(false)
  })

  it("returns false when env is '0'", () => {
    expect(isAutoPullEnabled("0", true)).toBe(false)
  })

  it("returns false when env is 'false'", () => {
    expect(isAutoPullEnabled("false", true)).toBe(false)
  })

  it("returns false when env is 'no'", () => {
    expect(isAutoPullEnabled("no", true)).toBe(false)
  })

  it("returns false when env is 'off'", () => {
    expect(isAutoPullEnabled("off", true)).toBe(false)
  })

  it("returns true when env is '1'", () => {
    expect(isAutoPullEnabled("1", false)).toBe(true)
  })

  it("returns true when env is 'true'", () => {
    expect(isAutoPullEnabled("true", false)).toBe(true)
  })

  it("returns true when env is 'yes'", () => {
    expect(isAutoPullEnabled("yes", false)).toBe(true)
  })

  it("returns true when env is 'on'", () => {
    expect(isAutoPullEnabled("on", false)).toBe(true)
  })

  it("is case-insensitive for truthy values", () => {
    expect(isAutoPullEnabled("TRUE", false)).toBe(true)
    expect(isAutoPullEnabled("Yes", false)).toBe(true)
  })

  it("is case-insensitive for falsy values", () => {
    expect(isAutoPullEnabled("FALSE", true)).toBe(false)
    expect(isAutoPullEnabled("No", true)).toBe(false)
  })
})
