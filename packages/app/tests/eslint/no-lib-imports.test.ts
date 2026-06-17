import { describe, expect, it } from "@effect/vitest"
import { Linter } from "eslint"
import tseslint from "typescript-eslint"

import { noLibImportsRule } from "../../eslint/no-lib-imports.mjs"

const defaultFilePath = "src/docker-git/new-client.ts"

const verify = (source: string, filePath: string) => {
  const linter = new Linter({ configType: "flat" })

  return linter.verify(
    source,
    [
      {
        files: ["**/*.ts"],
        languageOptions: {
          ecmaVersion: "latest",
          sourceType: "module",
          parser: tseslint.parser
        },
        plugins: {
          local: { rules: { "no-lib-imports": noLibImportsRule } }
        },
        rules: {
          "local/no-lib-imports": "error"
        }
      }
    ],
    filePath
  )
}

const line = (source: string): string => `${source}\n`

const lines = (source: ReadonlyArray<string>): string => source.join("\n")

const expectMessages = (
  source: string,
  expectedMessages: ReadonlyArray<ReadonlyArray<string>>,
  filePath: string = defaultFilePath
) => {
  const messages = verify(source, filePath)

  expect(messages).toHaveLength(expectedMessages.length)
  for (const [index, expectedMessageParts] of expectedMessages.entries()) {
    for (const expectedMessagePart of expectedMessageParts) {
      expect(messages[index]?.message).toContain(expectedMessagePart)
    }
  }
}

type ViolationCase = readonly [
  name: string,
  source: string,
  expectedMessages: ReadonlyArray<ReadonlyArray<string>>,
  filePath?: string
]

describe("noLibImportsRule", () => {
  const violationCases: ReadonlyArray<ViolationCase> = [
    ["rejects import declarations from lib", line("import { listProjects } from \"@effect-template/lib\""), [[
      "Direct import",
      "@effect-template/lib"
    ]]],
    [
      "rejects import declarations from the container-definition package",
      line("import { planFiles } from \"@prover-coder-ai/docker-git-container\""),
      [["Direct import", "@prover-coder-ai/docker-git-container"]]
    ],
    [
      "rejects deep imports from the container-definition package",
      line("import type { TemplateConfig } from \"@prover-coder-ai/docker-git-container/core/domain\""),
      [["@prover-coder-ai/docker-git-container/core/domain"]]
    ],
    [
      "rejects type-only import declarations from lib",
      line("import type { TemplateConfig } from \"@effect-template/lib/core/domain\""),
      [["@effect-template/lib/core/domain"]]
    ],
    [
      "rejects direct imports from @lib aliases",
      line("import type { Command } from \"@lib/core/domain\""),
      [["@lib/core/domain"]]
    ],
    [
      "rejects type import expressions from lib",
      line("type Template = import(\"@effect-template/lib/core/domain\").TemplateConfig"),
      [["@effect-template/lib/core/domain"]]
    ],
    ["rejects require calls from lib", line("const templateLib = require(\"@effect-template/lib\")"), [[
      "@effect-template/lib"
    ]]],
    [
      "rejects template literal module calls from lib",
      lines([
        "const requiredTemplateLib = require(`@effect-template/lib/core/domain`)",
        "const importedTemplateLib = await import(`@effect-template/lib/usecases/projects`)"
      ]),
      [["@effect-template/lib/core/domain"], ["@effect-template/lib/usecases/projects"]]
    ],
    [
      "rejects import equals require from lib",
      line("import templateLib = require(\"@effect-template/lib/core/domain\")"),
      [["@effect-template/lib/core/domain"]]
    ],
    [
      "rejects re-export declarations from lib",
      lines([
        "export { listProjects } from \"@effect-template/lib\"",
        "export * from \"@effect-template/lib/core/domain\""
      ]),
      [["@effect-template/lib"], ["@effect-template/lib/core/domain"]]
    ],
    [
      "rejects relative frontend imports into local src/lib",
      line("import { resolveRepoInput } from \"../lib/core/domain.js\""),
      [["../lib/core/domain.js"]]
    ],
    [
      "rejects relative app test imports into local src/lib",
      line("import { renderEntrypoint } from \"../../src/lib/core/templates-entrypoint.js\""),
      [["../../src/lib/core/templates-entrypoint.js"]],
      "tests/docker-git/legacy-import.test.ts"
    ],
    ["rejects migrated legacy paths too", line("import { listProjects } from \"@effect-template/lib\""), [[
      "Direct import"
    ]], "src/docker-git/program.ts"]
  ]

  for (const [name, source, expectedMessages, filePath] of violationCases) {
    it(name, () => {
      expectMessages(source, expectedMessages, filePath)
    })
  }

  it("allows non-lib imports", () => {
    const messages = verify(
      lines([
        "import { request } from \"./api-client.js\"",
        "import type { Command } from \"./frontend-lib/core/domain.js\""
      ]),
      defaultFilePath
    )

    expect(messages).toHaveLength(0)
  })

  it("allows app test imports that stay within frontend-owned surfaces", () => {
    const messages = verify(
      line("import { parse } from \"../../src/docker-git/cli/parser.js\""),
      "tests/docker-git/parser.test.ts"
    )

    expect(messages).toHaveLength(0)
  })
})
