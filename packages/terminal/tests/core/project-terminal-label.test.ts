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

const blankLabelArbitrary = fc.constantFrom("", " ", "  ")

const emptyOrMainRefArbitrary = fc.constantFrom("", " ", "  ", "main")

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

const projectFeatureLabelWithContainer = (
  { owner, repo }: GeneratedRepository,
  containerName: string
): string =>
  projectTerminalLabel({
    containerName,
    displayName: `${owner}/${repo}`,
    repoRef: "feature-x",
    repoUrl: `https://github.com/${owner}/${repo}.git`
  })

describe("projectTerminalLabel", () => {
  it("renders GitHub issue source URL and container identity", () => {
    expect(projectTerminalLabel({
      containerName: "dg-repo-issue-7",
      displayName: "org/repo",
      repoRef: "issue-7",
      repoUrl: "https://github.com/org/repo.git"
    })).toBe("https://github.com/org/repo/issues/7 | container dg-repo-issue-7")
  })

  it("renders GitHub pull request source URL from pull refs", () => {
    expect(projectTerminalLabel({
      containerName: "dg-repo-pr-42",
      displayName: "org/repo",
      repoRef: "refs/pull/42/head",
      repoUrl: "git@github.com:org/repo.git"
    })).toBe("https://github.com/org/repo/pull/42 | container dg-repo-pr-42")
  })

  it("renders repository source context for ordinary refs", () => {
    expect(projectTerminalLabel({
      displayName: "org/repo",
      repoRef: "feature-x",
      repoUrl: "https://github.com/org/repo.git"
    })).toBe("https://github.com/org/repo.git (feature-x)")
  })

  it("property-based invariant: issue-N mapping generates canonical GitHub issue URLs", () => {
    assertRepositoryRefIdProperty(({ owner, repo }, issueId) => {
      const label = projectTerminalLabel({
        displayName: `${owner}/${repo}`,
        repoRef: `issue-${issueId}`,
        repoUrl: `https://github.com/${owner}/${repo}.git`
      })

      expect(label).toBe(`https://github.com/${owner}/${repo}/issues/${issueId}`)
    })
  })

  it("property-based invariant: PR/MR markers generate review source context", () => {
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
              ? `https://github.com/${owner}/${repo}/pull/${reviewId}`
              : `MR #${reviewId}`
          )
        }
      )
    )
  })

  it("property-based invariant: displayName/repoUrl fallback is deterministic without source context", () => {
    fc.assert(
      fc.property(
        paddedReadableLabelArbitrary,
        blankLabelArbitrary,
        emptyOrMainRefArbitrary,
        (displayName, repoUrl, repoRef) => {
          expect(projectTerminalLabel({
            displayName,
            repoRef,
            repoUrl
          })).toBe(displayName.trim())
        }
      )
    )

    fc.assert(
      fc.property(
        paddedReadableLabelArbitrary,
        blankLabelArbitrary,
        emptyOrMainRefArbitrary,
        (repoUrl, displayName, repoRef) => {
          expect(projectTerminalLabel({
            displayName,
            repoRef,
            repoUrl
          })).toBe(repoUrl.trim())
        }
      )
    )
  })

  it("property-based invariant: repoUrl fallback is used when displayName is blank", () => {
    fc.assert(
      fc.property(repositoryArbitrary, blankLabelArbitrary, ({ owner, repo }, displayName) => {
        const repoUrl = `https://github.com/${owner}/${repo}.git`

        expect(projectTerminalLabel({
          displayName,
          repoRef: "main",
          repoUrl
        })).toBe(repoUrl)
      })
    )
  })

  it("property-based invariant: empty/main ref handling omits ref suffix", () => {
    fc.assert(
      fc.property(repositoryArbitrary, emptyOrMainRefArbitrary, ({ owner, repo }, repoRef) => {
        const repoUrl = `https://github.com/${owner}/${repo}.git`

        expect(projectTerminalLabel({
          displayName: `${owner}/${repo}`,
          repoRef,
          repoUrl
        })).toBe(repoUrl)
      })
    )
  })

  it("property-based invariant: container handling preserves non-empty container names after trimming", () => {
    fc.assert(
      fc.property(repositoryArbitrary, paddedReadableLabelArbitrary, (repository, containerName) => {
        const label = projectFeatureLabelWithContainer(repository, containerName)

        expect(label.endsWith(` | container ${containerName.trim()}`)).toBe(true)
      })
    )
  })

  it("property-based invariant: container handling omits blank container names", () => {
    fc.assert(
      fc.property(repositoryArbitrary, blankLabelArbitrary, (repository, containerName) => {
        const label = projectFeatureLabelWithContainer(repository, containerName)

        expect(label).not.toContain("container ")
      })
    )
  })
})
