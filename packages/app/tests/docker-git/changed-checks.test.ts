import { describe, expect, it } from "@effect/vitest"

import {
  createChangedChecksPlan,
  createGithubMatrix,
  type WorkspacePackage
} from "../../../../scripts/changed-checks.mjs"

const workspacePackages: ReadonlyArray<WorkspacePackage> = [
  {
    dependencyNames: ["@effect-template/lib", "@prover-coder-ai/docker-git-terminal"],
    dir: "packages/api",
    name: "@effect-template/api",
    scripts: {
      "lint:effect": "eslint --config eslint.effect-ts-check.config.mjs .",
      lint: "eslint .",
      test: "vitest run",
      typecheck: "tsc --noEmit -p tsconfig.json"
    }
  },
  {
    dependencyNames: [
      "@prover-coder-ai/docker-git-openapi",
      "@prover-coder-ai/docker-git-session-sync",
      "@prover-coder-ai/docker-git-terminal"
    ],
    dir: "packages/app",
    name: "@prover-coder-ai/docker-git",
    scripts: {
      "lint:effect": "eslint --config eslint.effect-ts-check.config.mjs .",
      "lint:tests": "eslint tests",
      lint: "eslint src",
      pretypecheck: "build deps",
      test: "vitest run",
      typecheck: "tsc --noEmit"
    }
  },
  {
    dependencyNames: [],
    dir: "packages/container",
    name: "@prover-coder-ai/docker-git-container",
    scripts: {
      "lint:effect": "eslint --config eslint.effect-ts-check.config.mjs .",
      lint: "eslint src",
      test: "vitest run --passWithNoTests",
      typecheck: "tsc --noEmit -p tsconfig.json"
    }
  },
  {
    dependencyNames: [],
    dir: "packages/docker-git-session-sync",
    name: "@prover-coder-ai/docker-git-session-sync",
    scripts: {
      "lint:effect": "eslint --config eslint.effect-ts-check.config.mjs .",
      test: "vitest run --passWithNoTests",
      typecheck: "tsc --noEmit -p tsconfig.json"
    }
  },
  {
    dependencyNames: ["@prover-coder-ai/docker-git-container", "@prover-coder-ai/docker-git-session-sync"],
    dir: "packages/lib",
    name: "@effect-template/lib",
    scripts: {
      "lint:effect": "eslint --config eslint.effect-ts-check.config.mjs .",
      lint: "eslint src",
      test: "vitest run --passWithNoTests",
      typecheck: "tsc --noEmit -p tsconfig.json"
    }
  },
  {
    dependencyNames: [],
    dir: "packages/openapi",
    name: "@prover-coder-ai/docker-git-openapi",
    scripts: { typecheck: "tsc --noEmit -p tsconfig.json" }
  },
  {
    dependencyNames: [],
    dir: "packages/terminal",
    name: "@prover-coder-ai/docker-git-terminal",
    scripts: {
      "lint:effect": "eslint --config eslint.effect-ts-check.config.mjs .",
      "lint:tests": "eslint tests",
      lint: "eslint src",
      test: "vitest run",
      typecheck: "tsc --noEmit"
    }
  }
]

const plan = (
  operation: "check" | "lint" | "lint:effect" | "test" | "typecheck",
  changedFiles: ReadonlyArray<string>
) => createChangedChecksPlan({ changedFiles, operation, packages: workspacePackages })

describe("changed-checks planner", () => {
  it("skips docs-only changes", () => {
    const result = plan("test", ["docs/process.md", "README.md"])

    expect(result.mode).toBe("skip")
    expect(result.commands).toEqual([])
  })

  it("fails closed to a full run for root toolchain changes", () => {
    const result = plan("test", ["bun.lock"])

    expect(result.mode).toBe("all")
    expect(result.commands.map((command) => command.packageName)).toEqual([
      "@prover-coder-ai/docker-git-container",
      "@prover-coder-ai/docker-git-session-sync",
      "@effect-template/lib",
      "@prover-coder-ai/docker-git-terminal",
      "@effect-template/api",
      "@prover-coder-ai/docker-git"
    ])
  })

  it("runs normal lint only for the owning package", () => {
    const result = plan("lint", ["packages/terminal/src/core/output-buffer.ts"])

    expect(result.mode).toBe("affected")
    expect(result.commands).toEqual([
      {
        args: ["run", "--filter", "@prover-coder-ai/docker-git-terminal", "lint"],
        command: "bun",
        packageName: "@prover-coder-ai/docker-git-terminal",
        phase: "lint",
        serial: false,
        scriptName: "lint"
      }
    ])
  })

  it("adds test lint when a package test file changed", () => {
    const result = plan("lint", ["packages/app/tests/docker-git/menu-create.test.ts"])

    expect(result.commands.map((command) => command.scriptName)).toEqual(["lint", "lint:tests"])
  })

  it("expands typecheck to transitive dependents", () => {
    const result = plan("typecheck", ["packages/terminal/src/core/output-buffer.ts"])

    expect(result.commands.map((command) => command.packageName)).toEqual([
      "@prover-coder-ai/docker-git-terminal",
      "@effect-template/api",
      "@prover-coder-ai/docker-git"
    ])
  })

  it("fails closed for unknown root files", () => {
    const result = plan("lint:effect", [".editorconfig"])

    expect(result.mode).toBe("all")
    expect(result.commands.length).toBeGreaterThan(1)
  })

  it("marks package commands with pre-hooks as serial for local execution", () => {
    const result = plan("typecheck", ["packages/app/src/web/api-http.ts"])

    expect(result.commands.find((command) => command.packageName === "@prover-coder-ai/docker-git")).toMatchObject({
      phase: "typecheck",
      serial: true,
      scriptName: "typecheck"
    })
  })

  it("builds a GitHub matrix per affected package command", () => {
    const result = plan("lint", [
      "packages/app/src/web/api-http.ts",
      "packages/app/tests/docker-git/api-http.test.ts"
    ])

    expect(createGithubMatrix(result)).toEqual({
      include: [
        {
          label: "@prover-coder-ai/docker-git lint",
          packageName: "@prover-coder-ai/docker-git",
          script: "lint"
        },
        {
          label: "@prover-coder-ai/docker-git lint:tests",
          packageName: "@prover-coder-ai/docker-git",
          script: "lint:tests"
        }
      ]
    })
  })
})
