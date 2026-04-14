import type { Dispatch, SetStateAction } from "react"
import { useEffect } from "react"

import type { ActionPromptState } from "./action-prompt.js"
import { createAuthActionPrompt } from "./action-prompt.js"
import type { GithubAuthStatus } from "./api.js"
import { githubAuthGateMessage, isGithubOauthPrompt, shouldRequireGithubAuth } from "./github-auth-gate.js"
import { browserMenuIndex } from "./menu.js"
import type { BrowserScreen } from "./screen.js"

type Setter<A> = Dispatch<SetStateAction<A>>

type GithubAuthGateArgs = {
  readonly actionPrompt: ActionPromptState | null
  readonly busyLabel: string | null
  readonly githubStatus: GithubAuthStatus | null
  readonly selectedMenuIndex: number
  readonly setActionPrompt: Setter<ActionPromptState | null>
  readonly setActiveScreen: Setter<BrowserScreen>
  readonly setMessage: Setter<string | null>
  readonly setSelectedMenuIndex: Setter<number>
}

export const useGithubAuthGate = ({
  actionPrompt,
  busyLabel,
  githubStatus,
  selectedMenuIndex,
  setActionPrompt,
  setActiveScreen,
  setMessage,
  setSelectedMenuIndex
}: GithubAuthGateArgs) => {
  useEffect(() => {
    if (busyLabel !== null || !shouldRequireGithubAuth(githubStatus)) {
      return
    }

    const authIndex = browserMenuIndex("Auth")
    if (selectedMenuIndex !== authIndex) {
      setSelectedMenuIndex(authIndex)
    }
    setActiveScreen({ tag: "Auth" })
    if (!isGithubOauthPrompt(actionPrompt)) {
      setActionPrompt(createAuthActionPrompt("GithubOauth"))
    }
    setMessage(githubAuthGateMessage(githubStatus))
  }, [
    actionPrompt,
    busyLabel,
    githubStatus,
    selectedMenuIndex,
    setActionPrompt,
    setActiveScreen,
    setMessage,
    setSelectedMenuIndex
  ])
}
