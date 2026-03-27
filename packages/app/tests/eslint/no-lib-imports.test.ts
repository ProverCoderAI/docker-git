import { describe, expect, it } from "@effect/vitest"
import { Linter } from "eslint"
import tseslint from "typescript-eslint"

import { noLibImportsRule } from "../../eslint/no-lib-imports.mjs"

const verify = (source: string, filePath: string, allowInFiles: ReadonlyArray<string> = []) => {
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
          "local/no-lib-imports": ["error", { allowInFiles }]
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

  it("rejects type import expressions from lib", () => {
    const messages = verify(
      "type Template = import(\"@effect-template/lib/core/domain\").TemplateConfig\n",
      "src/new-client.ts"
    )

    expect(messages).toHaveLength(1)
    expect(messages[0]?.message).toContain("@effect-template/lib/core/domain")
  })

  it("allows non-lib imports", () => {
    const messages = verify(
      "import { request } from \"./api-client.js\"\n",
      "src/new-client.ts"
    )

    expect(messages).toHaveLength(0)
  })

  it("allows explicit legacy allowlist entries", () => {
    const messages = verify(
      "import { listProjects } from \"@effect-template/lib\"\n",
      "src/docker-git/program.ts",
      ["src/docker-git/program.ts"]
    )

    expect(messages).toHaveLength(0)
  })
})
