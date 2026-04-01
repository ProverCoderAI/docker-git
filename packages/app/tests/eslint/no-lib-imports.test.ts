import { describe, expect, it } from "@effect/vitest"
import { Linter } from "eslint"
import tseslint from "typescript-eslint"

import { noLibImportsRule } from "../../eslint/no-lib-imports.mjs"

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

describe("noLibImportsRule", () => {
  it("rejects import declarations from lib", () => {
    const messages = verify(
      "import { listProjects } from \"@effect-template/lib\"\n",
      "src/new-client.ts"
    )

    expect(messages).toHaveLength(1)
    expect(messages[0]?.message).toContain("Direct import")
    expect(messages[0]?.message).toContain("@effect-template/lib")
  })

  it("rejects type-only import declarations from lib", () => {
    const messages = verify(
      "import type { TemplateConfig } from \"@effect-template/lib/core/domain\"\n",
      "src/new-client.ts"
    )

    expect(messages).toHaveLength(1)
    expect(messages[0]?.message).toContain("@effect-template/lib/core/domain")
  })

  it("rejects type import expressions from lib", () => {
    const messages = verify(
      "type Template = import(\"@effect-template/lib/core/domain\").TemplateConfig\n",
      "src/new-client.ts"
    )

    expect(messages).toHaveLength(1)
    expect(messages[0]?.message).toContain("@effect-template/lib/core/domain")
  })

  it("rejects require calls from lib", () => {
    const messages = verify(
      "const templateLib = require(\"@effect-template/lib\")\n",
      "src/new-client.ts"
    )

    expect(messages).toHaveLength(1)
    expect(messages[0]?.message).toContain("@effect-template/lib")
  })

  it("rejects template literal module calls from lib", () => {
    const messages = verify(
      [
        "const requiredTemplateLib = require(`@effect-template/lib/core/domain`)",
        "const importedTemplateLib = await import(`@effect-template/lib/usecases/projects`)"
      ].join("\n"),
      "src/new-client.ts"
    )

    expect(messages).toHaveLength(2)
    expect(messages[0]?.message).toContain("@effect-template/lib/core/domain")
    expect(messages[1]?.message).toContain("@effect-template/lib/usecases/projects")
  })

  it("rejects import equals require from lib", () => {
    const messages = verify(
      "import templateLib = require(\"@effect-template/lib/core/domain\")\n",
      "src/new-client.ts"
    )

    expect(messages).toHaveLength(1)
    expect(messages[0]?.message).toContain("@effect-template/lib/core/domain")
  })

  it("rejects re-export declarations from lib", () => {
    const messages = verify(
      [
        "export { listProjects } from \"@effect-template/lib\"",
        "export * from \"@effect-template/lib/core/domain\""
      ].join("\n"),
      "src/new-client.ts"
    )

    expect(messages).toHaveLength(2)
    expect(messages[0]?.message).toContain("@effect-template/lib")
    expect(messages[1]?.message).toContain("@effect-template/lib/core/domain")
  })

  it("allows non-lib imports", () => {
    const messages = verify(
      [
        "import { request } from \"./api-client.js\"",
        "import type { Command } from \"@lib/core/domain\""
      ].join("\n"),
      "src/new-client.ts"
    )

    expect(messages).toHaveLength(0)
  })

  it("rejects migrated legacy paths too", () => {
    const messages = verify(
      "import { listProjects } from \"@effect-template/lib\"\n",
      "src/docker-git/program.ts"
    )

    expect(messages).toHaveLength(1)
    expect(messages[0]?.message).toContain("Direct import")
  })
})
