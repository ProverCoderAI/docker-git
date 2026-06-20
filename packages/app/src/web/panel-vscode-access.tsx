import { Effect } from "effect"
import { useEffect } from "react"

import { startProjectSshTunnel } from "./api-share-links.js"
import type { TerminalPaneProps } from "./app-ready-terminal-types.js"

export type VsCodeAccessInfo = {
  readonly sshUser: string
  readonly targetDir: string
  readonly sshPort: number
}

export type CfTunnelState =
  | { readonly tag: "idle" }
  | { readonly tag: "loading" }
  | { readonly tag: "ready"; readonly hostname: string; readonly sshPassword: string }
  | { readonly tag: "failed" }

export const buildVsCodeAccessInfo = (project: TerminalPaneProps["project"]): VsCodeAccessInfo | null => {
  if (project === null) return null
  return { sshUser: project.sshUser, targetDir: project.targetDir, sshPort: project.sshPort }
}

export const startTunnel = (
  projectKey: string,
  setCfState: (s: CfTunnelState) => void
): void => {
  setCfState({ tag: "loading" })
  void Effect.runPromise(
    startProjectSshTunnel(projectKey).pipe(
      Effect.match({
        onFailure: () => {
          setCfState({ tag: "failed" })
        },
        onSuccess: ({ hostname, sshPassword }) => {
          setCfState(
            hostname === null
              ? { tag: "failed" }
              : { tag: "ready", hostname, sshPassword }
          )
        }
      })
    )
  )
}

export const useTunnelAutoStart = (
  isOpen: boolean,
  cfState: CfTunnelState,
  projectKey: string | undefined,
  setCfState: (s: CfTunnelState) => void
): void => {
  useEffect(() => {
    if (!isOpen || projectKey === undefined || cfState.tag !== "idle") return
    startTunnel(projectKey, setCfState)
  }, [isOpen, projectKey, cfState.tag, setCfState])
}

export const useTunnelPolling = (
  isOpen: boolean,
  cfState: CfTunnelState,
  projectKey: string | undefined,
  setCfState: (s: CfTunnelState) => void
): void => {
  useEffect(() => {
    if (!isOpen || cfState.tag !== "ready" || projectKey === undefined) return
    let isCancelled = false
    const id = setInterval(() => {
      void Effect.runPromise(
        startProjectSshTunnel(projectKey).pipe(
          Effect.match({
            onFailure: () => {
              if (!isCancelled) setCfState({ tag: "failed" })
            },
            onSuccess: ({ hostname, sshPassword }) => {
              if (isCancelled) return
              setCfState(hostname === null ? { tag: "failed" } : { tag: "ready", hostname, sshPassword })
            }
          })
        )
      )
    }, 30_000)
    return () => {
      isCancelled = true
      clearInterval(id)
    }
  }, [isOpen, cfState.tag, projectKey, setCfState])
}
