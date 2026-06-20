import { Effect } from "effect"
import { type CSSProperties, type Dispatch, type JSX, type SetStateAction } from "react"

import type { ShareLinkInfo } from "./api-share-links.js"
import { deleteTerminalSessionByPath } from "./api.js"
import { buttonStyle, codeBlockStyle, copyText, vscodeLinkStyle } from "./app-share-link-utils.js"
import { TerminalPanel } from "./panel-terminal.js"
import { type ActiveTerminalSession } from "./terminal.js"
import type { ViewportLayout } from "./viewport-layout.js"

export { buttonStyle, centeredBoxStyle, codeBlockStyle, copyText, vscodeLinkStyle } from "./app-share-link-utils.js"

export type ShareLinkState =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Error"; readonly message: string }
  | { readonly _tag: "Info"; readonly info: ShareLinkInfo }
  | { readonly _tag: "Connecting"; readonly info: ShareLinkInfo }
  | {
    readonly _tag: "Terminal"
    readonly info: ShareLinkInfo
    readonly session: ActiveTerminalSession
    readonly message: string | null
  }
  | { readonly _tag: "Closed"; readonly info: ShareLinkInfo; readonly closedMessage: string }

const sshPasswordBlockStyle: CSSProperties = {
  background: "#0d1a14",
  border: "1px solid #2a5a38",
  borderRadius: "3px",
  marginTop: "8px",
  padding: "8px"
}

const terminalAreaStyle: CSSProperties = {
  display: "flex",
  flex: 1,
  flexDirection: "column",
  minHeight: 0,
  overflow: "hidden"
}

export const SshConfigBlock = (
  { label, snippet }: { readonly label: string; readonly snippet: string }
): JSX.Element => (
  <div>
    <div style={{ color: "#8be9fd", fontSize: "0.9em", fontWeight: "bold", marginTop: "6px" }}>{label}</div>
    <code style={codeBlockStyle}>{snippet}</code>
    <button
      onClick={() => {
        copyText(snippet)
      }}
      style={{ ...buttonStyle, color: "#7fdfff", fontSize: "0.85em" }}
      type="button"
    >
      copy
    </button>
  </div>
)

const WILDCARD_SSH_CONFIG = `Host *.trycloudflare.com
  ProxyCommand cloudflared access ssh --hostname %h
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null`

const CfSshConnectSection = (
  { cfHostname }: { readonly cfHostname: string }
): JSX.Element => (
  <>
    <div style={{ color: "#8fa6c4", fontSize: "0.85em", marginTop: "6px" }}>After setup, connect to any container:</div>
    <code style={codeBlockStyle}>{`ssh dev@${cfHostname}`}</code>
    <button
      onClick={() => {
        copyText(`ssh dev@${cfHostname}`)
      }}
      style={{ ...buttonStyle, color: "#7fdfff", fontSize: "0.85em" }}
      type="button"
    >
      copy
    </button>
    <div style={{ color: "#8fa6c4", fontSize: "0.78em", marginTop: "4px" }}>
      Requires{" "}
      <a
        href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
        rel="noreferrer"
        style={{ color: "#7fdfff" }}
        target="_blank"
      >
        cloudflared
      </a>{" "}
      installed on your machine
    </div>
  </>
)

export const CfTunnelSetupBlock = (
  { cfHostname }: { readonly cfHostname: string | null }
): JSX.Element | null => {
  if (cfHostname === null) return null
  return (
    <div
      style={{
        background: "#0a1520",
        border: "1px solid #1a3a5a",
        borderRadius: "3px",
        marginTop: "8px",
        padding: "8px"
      }}
    >
      <div
        style={{
          alignItems: "baseline",
          display: "flex",
          flexWrap: "wrap",
          gap: "6px",
          justifyContent: "space-between"
        }}
      >
        <div style={{ color: "#7fdfff", fontSize: "0.9em", fontWeight: "bold" }}>One-time setup</div>
        <div style={{ color: "#8fa6c4", fontSize: "0.78em" }}>
          add once to ~/.ssh/config — works for all share links
        </div>
      </div>
      <code style={codeBlockStyle}>{WILDCARD_SSH_CONFIG}</code>
      <button
        onClick={() => {
          copyText(WILDCARD_SSH_CONFIG)
        }}
        style={{ ...buttonStyle, color: "#7fdfff", fontSize: "0.85em" }}
        type="button"
      >
        copy
      </button>
      <CfSshConnectSection cfHostname={cfHostname} />
    </div>
  )
}

const SshDirectLanSection = (
  { directCmd }: { readonly directCmd: string }
): JSX.Element | null =>
  directCmd === ""
    ? null
    : (
      <>
        <div style={{ color: "#8fa6c4", fontSize: "0.85em", marginTop: "6px" }}>Direct (LAN):</div>
        <code style={codeBlockStyle}>{directCmd}</code>
        <button
          onClick={() => {
            copyText(directCmd)
          }}
          style={{ ...buttonStyle, color: "#7fdfff", fontSize: "0.85em" }}
          type="button"
        >
          copy
        </button>
      </>
    )

const parseSshSnippet = (snippet: string): { hostname: string; port: string; user: string } => ({
  hostname: /HostName\s+(\S+)/.exec(snippet)?.[1] ?? "host",
  port: /Port\s+(\d+)/.exec(snippet)?.[1] ?? "22",
  user: /User\s+(\S+)/.exec(snippet)?.[1] ?? "dev"
})

export const SshPasswordBlock = (
  { info }: { readonly info: ShareLinkInfo }
): JSX.Element | null => {
  if (info.sshPassword === null) return null
  const { hostname, port, user } = parseSshSnippet(info.sshConfigSnippet)
  const directCmd = hostname === "localhost" ? "" : `ssh ${user}@${hostname} -p ${port}`
  return (
    <div style={sshPasswordBlockStyle}>
      <div style={{ color: "#56f39a", fontSize: "0.9em", fontWeight: "bold", marginBottom: "4px" }}>SSH password</div>
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "6px" }}>
        <code style={{ ...codeBlockStyle, display: "inline", marginBottom: 0, marginTop: 0 }}>{info.sshPassword}</code>
        <button
          onClick={() => {
            copyText(info.sshPassword as string)
          }}
          style={{ ...buttonStyle, color: "#56f39a", fontSize: "0.85em" }}
          type="button"
        >
          copy
        </button>
      </div>
      <SshDirectLanSection directCmd={directCmd} />
    </div>
  )
}

export const InfoHeader = (
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
  <div
    style={{
      background: "#101419",
      border: "1px solid #3a4652",
      borderRadius: "4px",
      flexShrink: 0,
      marginBottom: "8px",
      overflowY: "auto",
      padding: "8px"
    }}
  >
    <div
      style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "space-between" }}
    >
      <div style={{ color: "#8be9fd", fontWeight: "bold" }}>{info.displayName}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        <a href={info.vscodeUri} style={vscodeLinkStyle}>open in VS Code</a>
        {info.cfVscodeUri !== null && (
          <a href={info.cfVscodeUri} style={{ ...vscodeLinkStyle, color: "#7fdfff" }}>VS Code (CF tunnel)</a>
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
    <CfTunnelSetupBlock cfHostname={info.cfSshConfigSnippet?.match(/HostName\s+(\S+)/)?.[1] ?? null} />
    <SshPasswordBlock info={info} />
    <SshConfigBlock label="SSH config (direct, LAN)" snippet={info.sshConfigSnippet} />
    <div style={{ color: "#8fa6c4", fontSize: "0.8em", marginTop: "6px" }}>
      expires {new Date(info.expiresAt).toLocaleString()}
    </div>
  </div>
)

export const TerminalView = (
  {
    message,
    session,
    setState,
    viewport
  }: {
    readonly message: string | null
    readonly session: ActiveTerminalSession
    readonly setState: Dispatch<SetStateAction<ShareLinkState>>
    readonly viewport: ViewportLayout
  }
): JSX.Element => (
  <div style={terminalAreaStyle}>
    {message !== null && (
      <div style={{ color: "#f6d27b", flexShrink: 0, marginBottom: "4px", padding: "2px 6px" }}>{message}</div>
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
        setState((current) => current._tag === "Terminal" ? { _tag: "Info", info: current.info } : current)
      }}
      onKill={() => {
        void Effect.runPromise(
          deleteTerminalSessionByPath(session.closePath).pipe(Effect.either, Effect.asVoid)
        )
        setState((current) => current._tag === "Terminal" ? { _tag: "Info", info: current.info } : current)
      }}
      onMessage={(msg) => {
        setState((current) => current._tag === "Terminal" ? { ...current, message: msg } : current)
      }}
      session={session}
    />
  </div>
)

export const PlaceholderArea = ({ children }: { readonly children: JSX.Element }): JSX.Element => (
  <div style={{ ...terminalAreaStyle, alignItems: "center", justifyContent: "center" }}>
    {children}
  </div>
)
