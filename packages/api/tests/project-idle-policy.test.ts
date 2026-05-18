import { describe, expect, it } from "vitest"

import { decideProjectIdleAction, type ProjectIdlePolicyInput } from "../src/services/project-idle-policy.js"

const nowEpochMs = Date.parse("2026-05-18T12:00:00.000Z")
const timeoutMs = 30 * 60 * 1000

const makeInput = (overrides: Partial<ProjectIdlePolicyInput> = {}): ProjectIdlePolicyInput => ({
  hasActiveAgent: false,
  hasLiveInteractiveSession: false,
  lastAgentSeenAtEpochMs: nowEpochMs - timeoutMs - 1,
  lastInteractiveSeenAtEpochMs: nowEpochMs - timeoutMs - 1,
  resourceProfile: "normal",
  running: true,
  startedAtEpochMs: nowEpochMs - timeoutMs - 1,
  ...overrides
})

const decide = (input: ProjectIdlePolicyInput) =>
  decideProjectIdleAction(input, { agentIdleTimeoutMs: timeoutMs, nowEpochMs })

describe("project idle policy", () => {
  it("keeps a running project when an agent is active", () => {
    expect(decide(makeInput({ hasActiveAgent: true }))).toEqual({ _tag: "KeepRunning" })
  })

  it("restores normal resources when an agent becomes active in a throttled project", () => {
    expect(decide(makeInput({
      hasActiveAgent: true,
      resourceProfile: "interactive-idle-throttled"
    }))).toEqual({ _tag: "RestoreNormalResources" })
  })

  it("throttles but does not suspend when a live interactive session is attached", () => {
    expect(decide(makeInput({ hasLiveInteractiveSession: true }))).toEqual({
      _tag: "ThrottleInteractiveIdle"
    })
  })

  it("suspends only after the idle timeout with no agent and no live interactive session", () => {
    expect(decide(makeInput())).toEqual({ _tag: "SuspendIdle" })
  })

  it("keeps a recently used project running until the idle timeout expires", () => {
    expect(decide(makeInput({ lastAgentSeenAtEpochMs: nowEpochMs - timeoutMs + 1 }))).toEqual({
      _tag: "KeepRunning"
    })
  })
})
