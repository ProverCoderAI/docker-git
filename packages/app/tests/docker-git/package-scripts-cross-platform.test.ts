import { describe, expect, it } from "@effect/vitest"
import * as fc from "fast-check"

import rootPackage from "../../../../package.json" with { type: "json" }
import sessionSyncPackage from "../../../docker-git-session-sync/package.json" with { type: "json" }
import appPackage from "../../package.json" with { type: "json" }

const launchScripts: ReadonlyArray<Readonly<{ packageName: string; scriptName: string; script: string }>> = [
  { packageName: "workspace", scriptName: "clone", script: rootPackage.scripts.clone },
  { packageName: "workspace", scriptName: "open", script: rootPackage.scripts.open },
  { packageName: "workspace", scriptName: "docker-git", script: rootPackage.scripts["docker-git"] },
  { packageName: "workspace", scriptName: "list", script: rootPackage.scripts.list },
  { packageName: "workspace", scriptName: "start", script: rootPackage.scripts.start },
  { packageName: "@prover-coder-ai/docker-git", scriptName: "clone", script: appPackage.scripts.clone },
  { packageName: "@prover-coder-ai/docker-git", scriptName: "open", script: appPackage.scripts.open },
  {
    packageName: "@prover-coder-ai/docker-git",
    scriptName: "docker-git",
    script: appPackage.scripts["docker-git"]
  },
  { packageName: "@prover-coder-ai/docker-git", scriptName: "list", script: appPackage.scripts.list },
  { packageName: "@prover-coder-ai/docker-git", scriptName: "start", script: appPackage.scripts.start }
]

describe("package scripts cross-platform contract", () => {
  it("keeps user-facing launch scripts independent from bash", () => {
    fc.assert(fc.property(fc.constantFrom(...launchScripts), (entry) => {
      expect(entry.script, `${entry.packageName}:${entry.scriptName}`).not.toMatch(/\bbash(?:\.exe)?\b/u)
    }))
  })

  it("keeps final package build independent from raw chmod", () => {
    fc.assert(fc.property(fc.constant(sessionSyncPackage.scripts.build), (script) => {
      expect(script).not.toMatch(/\bchmod\s+/u)
    }))
  })
})
