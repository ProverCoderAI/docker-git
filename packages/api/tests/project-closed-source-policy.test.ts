import { describe, expect, it } from "vitest"

import {
  decideProjectClosedSourceAction,
  type ProjectClosedSourcePolicyInput
} from "../src/services/project-closed-source-policy.js"

const makeInput = (overrides: Partial<ProjectClosedSourcePolicyInput> = {}): ProjectClosedSourcePolicyInput => ({
  sourceState: "closed",
  hasActiveAgent: false,
  hasLiveInteractiveSession: false,
  ...overrides
})

describe("project closed-source policy", () => {
  it("deletes a closed-source project with no active work", () => {
    expect(decideProjectClosedSourceAction(makeInput())).toEqual({ _tag: "Delete" })
  })

  it("keeps an open-source project", () => {
    expect(decideProjectClosedSourceAction(makeInput({ sourceState: "open" }))).toEqual({
      _tag: "Keep",
      reason: "source-open-or-unknown"
    })
  })

  it("keeps a project whose source state is unknown", () => {
    expect(decideProjectClosedSourceAction(makeInput({ sourceState: "unknown" }))).toEqual({
      _tag: "Keep",
      reason: "source-open-or-unknown"
    })
  })

  it("keeps a closed-source project while an agent is active", () => {
    expect(decideProjectClosedSourceAction(makeInput({ hasActiveAgent: true }))).toEqual({
      _tag: "Keep",
      reason: "active-agent"
    })
  })

  it("keeps a closed-source project while an interactive session is live", () => {
    expect(decideProjectClosedSourceAction(makeInput({ hasLiveInteractiveSession: true }))).toEqual({
      _tag: "Keep",
      reason: "live-interactive-session"
    })
  })

  it("prefers the active-agent reason over a live interactive session", () => {
    expect(
      decideProjectClosedSourceAction(makeInput({ hasActiveAgent: true, hasLiveInteractiveSession: true }))
    ).toEqual({ _tag: "Keep", reason: "active-agent" })
  })

  it("never deletes an open project even with no active work", () => {
    expect(decideProjectClosedSourceAction(makeInput({ sourceState: "open" }))._tag).toBe("Keep")
  })
})
