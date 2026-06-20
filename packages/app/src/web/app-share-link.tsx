import { Effect, Match } from "effect"
import { type CSSProperties, type Dispatch, type JSX, type SetStateAction, useEffect, useState } from "react"

import { loadShareLink } from "./api-share-links.js"
import type { ShareLinkInfo } from "./api-share-links.js"
import { createProjectTerminalSession } from "./api.js"
import {
  centeredBoxStyle,
  InfoHeader,
  PlaceholderArea,
  type ShareLinkState,
  TerminalView
} from "./app-share-link-sections.js"
import { buildProjectActiveTerminalSession } from "./terminal.js"
import type { ViewportLayout } from "./viewport-layout.js"

export type AppShareLinkProps = {
  readonly projectKey: string
  readonly shareToken: string
  readonly viewport: ViewportLayout
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  overflow: "hidden",
  padding: "8px"
}

const connectTerminalSession = (
  projectKey: string,
  info: ShareLinkInfo,
  setState: Dispatch<SetStateAction<ShareLinkState>>
): void => {
  void Effect.runPromise(
    createProjectTerminalSession(projectKey).pipe(
      Effect.map(({ session }) => {
        const activeSession = buildProjectActiveTerminalSession({
          onExit: () => {
            setState((current) => current._tag === "Terminal" ? { _tag: "Info", info: current.info } : current)
          },
          projectDisplayName: info.displayName,
          projectId: session.projectId,
          projectKey,
          session
        })
        setState((current) =>
          current._tag === "Connecting"
            ? { _tag: "Terminal", info: current.info, message: null, session: activeSession }
            : current
        )
      }),
      Effect.catchAll((error) =>
        Effect.sync(() => {
          setState((current) =>
            current._tag === "Connecting"
              ? { _tag: "Closed", closedMessage: error, info: current.info }
              : current
          )
        })
      )
    )
  )
}

const renderInfoCase = (
  info: ShareLinkInfo,
  projectKey: string,
  setState: Dispatch<SetStateAction<ShareLinkState>>
): JSX.Element => (
  <div style={containerStyle}>
    <InfoHeader
      info={info}
      isConnecting={false}
      onConnect={() => {
        setState({ _tag: "Connecting", info })
        connectTerminalSession(projectKey, info, setState)
      }}
    />
    <PlaceholderArea>
      <div style={centeredBoxStyle}>
        <div style={{ color: "#d6e5f7" }}>Add the one-time setup to ~/.ssh/config</div>
        <div style={{ color: "#8fa6c4", marginTop: "4px" }}>
          then click <span style={{ color: "#7fdfff" }}>VS Code (CF tunnel)</span> to connect from anywhere
        </div>
      </div>
    </PlaceholderArea>
  </div>
)

const renderClosedCase = (
  info: ShareLinkInfo,
  closedMessage: string,
  projectKey: string,
  setState: Dispatch<SetStateAction<ShareLinkState>>
): JSX.Element => (
  <div style={containerStyle}>
    <InfoHeader
      info={info}
      isConnecting={false}
      onConnect={() => {
        setState({ _tag: "Connecting", info })
        connectTerminalSession(projectKey, info, setState)
      }}
    />
    <PlaceholderArea>
      <div style={centeredBoxStyle}>
        <div style={{ color: "#ffd8de" }}>Session ended</div>
        <div style={{ color: "#8fa6c4", marginTop: "4px" }}>{closedMessage}</div>
      </div>
    </PlaceholderArea>
  </div>
)

const renderState = (
  state: ShareLinkState,
  setState: Dispatch<SetStateAction<ShareLinkState>>,
  projectKey: string,
  viewport: ViewportLayout
): JSX.Element =>
  Match.value(state).pipe(
    Match.when({ _tag: "Loading" }, () => (
      <PlaceholderArea>
        <div style={centeredBoxStyle}>
          <div style={{ color: "#8be9fd", fontWeight: "bold" }}>Share link</div>
          <div style={{ color: "#8fa6c4", marginTop: "4px" }}>Validating token…</div>
        </div>
      </PlaceholderArea>
    )),
    Match.when({ _tag: "Error" }, ({ message }) => (
      <PlaceholderArea>
        <div style={{ ...centeredBoxStyle, border: "1px solid #ff6b7d" }}>
          <div style={{ color: "#ffd8de", fontWeight: "bold" }}>Share link unavailable</div>
          <div style={{ color: "#f2b7bf", marginTop: "4px" }}>{message}</div>
        </div>
      </PlaceholderArea>
    )),
    Match.when({ _tag: "Info" }, ({ info }) => renderInfoCase(info, projectKey, setState)),
    Match.when({ _tag: "Connecting" }, ({ info }) => (
      <div style={containerStyle}>
        <InfoHeader info={info} isConnecting={true} onConnect={() => {}} />
        <PlaceholderArea>
          <div style={centeredBoxStyle}>
            <div style={{ color: "#7fdfff" }}>Starting SSH terminal session…</div>
          </div>
        </PlaceholderArea>
      </div>
    )),
    Match.when({ _tag: "Terminal" }, ({ info, message, session }) => (
      <div style={containerStyle}>
        <InfoHeader info={info} isConnecting={false} onConnect={() => {}} />
        <TerminalView message={message} session={session} setState={setState} viewport={viewport} />
      </div>
    )),
    Match.when({ _tag: "Closed" }, ({ closedMessage, info }) =>
      renderClosedCase(info, closedMessage, projectKey, setState)),
    Match.exhaustive
  )

export const AppShareLink = (
  { projectKey, shareToken, viewport }: AppShareLinkProps
): JSX.Element => {
  const [state, setState] = useState<ShareLinkState>({ _tag: "Loading" })

  useEffect(() => {
    let isCancelled = false
    const portSuffix = location.port === "" ? "" : `:${location.port}`
    const clientHost = `${location.hostname}${portSuffix}`
    void Effect.runPromise(
      loadShareLink(shareToken, clientHost).pipe(
        Effect.match({
          onFailure: (message) => {
            if (!isCancelled) setState({ _tag: "Error", message })
          },
          onSuccess: (info) => {
            if (!isCancelled) setState({ _tag: "Info", info })
          }
        })
      )
    )
    return () => {
      isCancelled = true
    }
  }, [shareToken])

  return renderState(state, setState, projectKey, viewport)
}
