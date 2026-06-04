import * as fc from "fast-check"
import { describe, expect, it } from "vitest"

import { projectTerminalLabel } from "../../src/core/project-terminal-label.js"

const asciiCodeToCharacter = (code: number): string => String.fromCodePoint(code)

const alphaNumericCharacterArbitrary = fc.oneof(
  fc.integer({ max: 57, min: 48 }),
  fc.integer({ max: 90, min: 65 }),
  fc.integer({ max: 122, min: 97 })
).map((code) => asciiCodeToCharacter(code))

const pathCharacterArbitrary = fc.oneof(alphaNumericCharacterArbitrary, fc.constant("-"))

const labelCharacterArbitrary = fc.oneof(
  pathCharacterArbitrary,
  fc.constant("_"),
  fc.constant("."),
  fc.constant("/")
)

const gitHubPathSegmentArbitrary = fc.tuple(
  alphaNumericCharacterArbitrary,
  fc.array(pathCharacterArbitrary, { maxLength: 12 })
).map(([head, tail]) => `${head}${tail.join("")}`)

const readableLabelArbitrary = fc.array(labelCharacterArbitrary, {
  maxLength: 24,
  minLength: 1
}).map((characters) => characters.join(""))

const paddedReadableLabelArbitrary = fc.tuple(
  fc.constantFrom("", " ", "  "),
  readableLabelArbitrary,
  fc.constantFrom("", " ", "  ")
).map(([left, value, right]) => `${left}${value}${right}`)

const repositoryArbitrary = fc.record({
  owner: gitHubPathSegmentArbitrary,
  repo: gitHubPathSegmentArbitrary
})

type GeneratedRepository = {
  readonly owner: string
  readonly repo: string
}

const refIdArbitrary = fc.integer({ max: 1_000_000, min: 1 })

const assertRepositoryRefIdProperty = (
  assertion: (repository: GeneratedRepository, refId: number) => void
): void => {
  fc.assert(fc.property(repositoryArbitrary, refIdArbitrary, assertion))
}

describe("projectTerminalLabel", () => {
  it("renders GitHub issue source context and container identity", () => {
    expect(projectTerminalLabel({
      containerName: "dg-repo-issue-7",
      displayName: "org/repo",
      repoRef: "issue-7",
      repoUrl: "https://github.com/org/repo.git"
    })).toBe("org/repo | issue #7 (https://github.com/org/repo/issues/7) | container dg-repo-issue-7")
  })

  it("renders GitHub pull request source context from pull refs", () => {
    expect(projectTerminalLabel({
      containerName: "dg-repo-pr-42",
      displayName: "org/repo",
      repoRef: "refs/pull/42/head",
      repoUrl: "git@github.com:org/repo.git"
    })).toBe("org/repo | PR #42 (https://github.com/org/repo/pull/42) | container dg-repo-pr-42")
  })

  it("renders repository source context for ordinary refs", () => {
    expect(projectTerminalLabel({
      displayName: "org/repo",
      repoRef: "feature-x",
      repoUrl: "https://github.com/org/repo.git"
    })).toBe("org/repo | source https://github.com/org/repo.git (feature-x)")
  })

  it("preserves issue markers and GitHub issue URLs for generated issue refs", () => {
    assertRepositoryRefIdProperty(({ owner, repo }, issueId) => {
      const label = projectTerminalLabel({
        displayName: `${owner}/${repo}`,
        repoRef: `issue-${issueId}`,
        repoUrl: `https://github.com/${owner}/${repo}.git`
      })

      expect(label).toBe(
        `${owner}/${repo} | issue #${issueId} (https://github.com/${owner}/${repo}/issues/${issueId})`
      )
    })
  })

  it("preserves PR and MR markers for generated review refs", () => {
    fc.assert(
      fc.property(
        repositoryArbitrary,
        refIdArbitrary,
        fc.constantFrom("pull", "merge-request"),
        ({ owner, repo }, reviewId, refKind) => {
          const repoUrl = `git@github.com:${owner}/${repo}.git`
          const label = projectTerminalLabel({
            displayName: `${owner}/${repo}`,
            repoRef: refKind === "pull" ? `refs/pull/${reviewId}/head` : `refs/merge-requests/${reviewId}/head`,
            repoUrl
          })

          expect(label).toBe(
            refKind === "pull"
              ? `${owner}/${repo} | PR #${reviewId} (https://github.com/${owner}/${repo}/pull/${reviewId})`
              : `${owner}/${repo} | MR #${reviewId}`
          )
        }
      )
    )
  })

  it("uses repoUrl as the base label when displayName is blank", () => {
    fc.assert(
      fc.property(repositoryArbitrary, fc.constantFrom("", " ", "  "), ({ owner, repo }, displayName) => {
        const repoUrl = `https://github.com/${owner}/${repo}.git`

        expect(projectTerminalLabel({
          displayName,
          repoRef: "main",
          repoUrl
        })).toBe(`${repoUrl} | source ${repoUrl}`)
      })
    )
  })

  it("normalizes empty and main refs to source context without ref suffix", () => {
    fc.assert(
      fc.property(repositoryArbitrary, fc.constantFrom("", " ", "  ", "main"), ({ owner, repo }, repoRef) => {
        const repoUrl = `https://github.com/${owner}/${repo}.git`

        expect(projectTerminalLabel({
          displayName: `${owner}/${repo}`,
          repoRef,
          repoUrl
        })).toBe(`${owner}/${repo} | source ${repoUrl}`)
      })
    )
  })

  it("preserves non-empty container names after trimming", () => {
    fc.assert(
      fc.property(repositoryArbitrary, paddedReadableLabelArbitrary, ({ owner, repo }, containerName) => {
        const label = projectTerminalLabel({
          containerName,
          displayName: `${owner}/${repo}`,
          repoRef: "feature-x",
          repoUrl: `https://github.com/${owner}/${repo}.git`
        })

        expect(label.endsWith(` | container ${containerName.trim()}`)).toBe(true)
      })
    )
  })
})
