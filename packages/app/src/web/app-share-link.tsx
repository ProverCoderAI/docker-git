import { Effect, Match } from "effect"
import { type CSSProperties, type Dispatch, type JSX, type SetStateAction, useEffect, useState } from "react"

import { createProjectTerminalSession, deleteTerminalSessionByPath } from "./api.js"
import type { ShareLinkInfo } from "./api-share-links.js"
import { loadShareLink } from "./api-share-links.js"
import { TerminalPanel } from "./panel-terminal.js"
import { buildProjectActiveTerminalSession, type ActiveTerminalSession } from "./terminal.js"
import type { ViewportLayout } from "./viewport-layout.js"

// CHANGE: standalone share link page – validates token, shows SSH config and web terminal
// WHY: share links must work without dashboard state; token provides the authorization
// QUOTE(ТЗ): "принимает ссылку на любой IP который стоит у пользователя в URL"
// REF: issue-428
// PURITY: SHELL (React component with effects)
// INVARIANT: token is only accepted when it matches the 16-hex share format

type ShareLinkState =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Error"; readonly message: string }
  | { readonly _tag: "Info"; readonly info: ShareLinkInfo }
  | { readonly _tag: "Connecting"; readonly info: ShareLinkInfo }
  | { readonly _tag: "Terminal"; readonly info: ShareLinkInfo; readonly session: ActiveTerminalSession; readonly message: string | null }
  | { readonly _tag: "Closed"; readonly info: ShareLinkInfo; readonly closedMessage: string }

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

const headerStyle: CSSProperties = {
  background: "#101419",
  border: "1px solid #3a4652",
  borderRadius: "4px",
  flexShrink: 0,
  marginBottom: "8px",
  overflowY: "auto",
  padding: "8px"
}

const terminalAreaStyle: CSSProperties = {
  display: "flex",
  flex: 1,
  flexDirection: "column",
  minHeight: 0,
  overflow: "hidden"
}

const buttonStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#56f39a",
  cursor: "pointer",
  font: "inherit",
  fontWeight: "bold",
  padding: "2px 6px"
}

const codeBlockStyle: CSSProperties = {
  background: "#0b1017",
  border: "1px solid #2a3640",
  borderRadius: "2px",
  color: "#a8c8f0",
  display: "block",
  fontFamily: "inherit",
  fontSize: "0.85em",
  marginBottom: "4px",
  marginTop: "4px",
  overflowX: "auto",
  padding: "6px 8px",
  whiteSpace: "pre"
}

const copyText = (text: string): void => {
  void navigator.clipboard.writeText(text).catch(() => {})
}

const vscodeLinkStyle: CSSProperties = {
  color: "#56f39a",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "inherit",
  fontWeight: "bold",
  padding: "2px 6px",
  textDecoration: "none"
}

const SshConfigBlock = (
  { label, snippet }: { readonly label: string; readonly snippet: string }
): JSX.Element => (
  <div>
    <div style={{ color: "#8be9fd", fontSize: "0.9em", fontWeight: "bold", marginTop: "6px" }}>{label}</div>
    <code style={codeBlockStyle}>{snippet}</code>
    <button
      onClick={() => copyText(snippet)}
      style={{ ...buttonStyle, color: "#7fdfff", fontSize: "0.85em" }}
      type="button"
    >
      copy
    </button>
  </div>
)

const InfoHeader = (
  {
    info,
    isConnecting,
    onConnect
  }: {
    readonly info: ShareLinkInfo
    readonly isConnecting: boolean
    readonly onConnect: () => void
  }
): JSX.Element => (
  <div style={headerStyle}>
    <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "space-between" }}>
      <div style={{ color: "#8be9fd", fontWeight: "bold" }}>{info.displayName}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        <a href={info.vscodeUri} style={vscodeLinkStyle}>
          open in VS Code
        </a>
        {info.cfVscodeUri !== null && (
          <a href={info.cfVscodeUri as string} style={{ ...vscodeLinkStyle, color: "#7fdfff" }}>
            VS Code (CF tunnel)
          </a>
        )}
        <button
          disabled={isConnecting}
          onClick={onConnect}
          style={{ ...buttonStyle, color: isConnecting ? "#8fa6c4" : "#ffd166" }}
          type="button"
        >
          {isConnecting ? "connecting…" : "connect terminal"}
        </button>
      </div>
    </div>
    <SshConfigBlock label="SSH config (direct)" snippet={info.sshConfigSnippet} />
    {info.cfSshConfigSnippet !== null && (
      <SshConfigBlock label="SSH config (Cloudflare tunnel)" snippet={info.cfSshConfigSnippet as string} />
    )}
    <div style={{ color: "#8fa6c4", fontSize: "0.8em", marginTop: "6px" }}>
      expires {new Date(info.expiresAt).toLocaleString()}
    </div>
  </div>
)

const TerminalView = (
  {
    info,
    message,
    session,
    setState,
    viewport
  }: {
    readonly info: ShareLinkInfo
    readonly message: string | null
    readonly session: ActiveTerminalSession
    readonly setState: Dispatch<SetStateAction<ShareLinkState>>
    readonly viewport: ViewportLayout
  }
): JSX.Element => (
  <div style={terminalAreaStyle}>
    {message !== null && (
      <div style={{ color: "#f6d27b", flexShrink: 0, marginBottom: "4px", padding: "2px 6px" }}>
        {message}
      </div>
    )}
    <TerminalPanel
      keyboardOpen={viewport.keyboardOpen}
      mobileMode={viewport.mode === "mobile"}
      onAttachFailure={() => {
        setState((current) =>
          current._tag === "Terminal"
            ? { _tag: "Closed", closedMessage: "Terminal attach failed.", info: current.info }
            : current
        )
      }}
      onDetach={() => {
        setState((current) =>
          current._tag === "Terminal"
            ? { _tag: "Info", info: current.info }
            : current
        )
      }}
      onKill={() => {
        void Effect.runPromise(
          deleteTerminalSessionByPath(session.closePath).pipe(Effect.either, Effect.asVoid)
        )
        setState((current) =>
          current._tag === "Terminal"
            ? { _tag: "Info", info: current.info }
            : current
        )
      }}
      onMessage={(msg) => {
        setState((current) =>
          current._tag === "Terminal" ? { ...current, message: msg } : current
        )
      }}
      session={session}
    />
  </div>
)

const PlaceholderArea = ({ children }: { readonly children: JSX.Element }): JSX.Element => (
  <div style={{ ...terminalAreaStyle, alignItems: "center", justifyContent: "center" }}>
    {children}
  </div>
)

const centeredBoxStyle: CSSProperties = {
  border: "1px solid #3a4652",
  borderRadius: "4px",
  color: "#d6e5f7",
  padding: "16px 24px",
  textAlign: "center"
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
            setState((current) =>
              current._tag === "Terminal"
                ? { _tag: "Info", info: current.info }
                : current
            )
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
              ? { _tag: "Closed", closedMessage: String(error), info: current.info }
              : current
          )
        })
      )
    )
  )
}

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
    Match.when({ _tag: "Info" }, ({ info }) => (
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
            <div style={{ color: "#d6e5f7" }}>Add the SSH config above to ~/.ssh/config</div>
            <div style={{ color: "#8fa6c4", marginTop: "4px" }}>
              then click <span style={{ color: "#56f39a" }}>open in VS Code</span> to connect
            </div>
          </div>
        </PlaceholderArea>
      </div>
    )),
    Match.when({ _tag: "Connecting" }, ({ info }) => (
      <div style={containerStyle}>
        <InfoHeader
          info={info}
          isConnecting={true}
          onConnect={() => {}}
        />
        <PlaceholderArea>
          <div style={centeredBoxStyle}>
            <div style={{ color: "#7fdfff" }}>Starting SSH terminal session…</div>
          </div>
        </PlaceholderArea>
      </div>
    )),
    Match.when({ _tag: "Terminal" }, ({ info, message, session }) => (
      <div style={containerStyle}>
        <InfoHeader
          info={info}
          isConnecting={false}
          onConnect={() => {}}
        />
        <TerminalView
          info={info}
          message={message}
          session={session}
          setState={setState}
          viewport={viewport}
        />
      </div>
    )),
    Match.when({ _tag: "Closed" }, ({ closedMessage, info }) => (
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
    )),
    Match.exhaustive
  )

export const AppShareLink = (
  { projectKey, shareToken, viewport }: AppShareLinkProps
): JSX.Element => {
  const [state, setState] = useState<ShareLinkState>({ _tag: "Loading" })

  useEffect(() => {
    let cancelled = false
    const clientHost = `${window.location.hostname}${window.location.port !== "" ? `:${window.location.port}` : ""}`
    void Effect.runPromise(
      loadShareLink(shareToken, clientHost).pipe(
        Effect.match({
          onFailure: (message) => {
            if (!cancelled) {
              setState({ _tag: "Error", message })
            }
          },
          onSuccess: (info) => {
            if (!cancelled) {
              setState({ _tag: "Info", info })
            }
          }
        })
      )
    )
    return () => {
      cancelled = true
    }
  }, [shareToken])

  return renderState(state, setState, projectKey, viewport)
}
