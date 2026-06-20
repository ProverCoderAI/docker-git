import { type CSSProperties, type JSX } from "react"

import type { CfTunnelState, VsCodeAccessInfo } from "./panel-vscode-access.js"

type VsCodeAccessPanelProps = {
  readonly cfState: CfTunnelState
  readonly info: VsCodeAccessInfo
  readonly onClose: () => void
  readonly onRefresh: () => void
  readonly onRetry: () => void
}

type CfReadyDetailsProps = {
  readonly cfSshConfig: string
  readonly cfSshCommand: string
  readonly cfVscodeUri: string | null
  readonly sshPassword: string
}

type DirectSshSectionProps = {
  readonly cfReadyPassword: string | null
  readonly directCommand: string
  readonly directConfig: string
  readonly directVscodeUri: string
}

type VsCodeAccessValues = {
  readonly cfSshConfig: string | null
  readonly cfSshCommand: string | null
  readonly cfVscodeUri: string | null
  readonly directConfig: string
  readonly directCommand: string
  readonly directVscodeUri: string
}

const hostSshConfig = (hostname: string, sshUser: string): string =>
  `Host ${hostname}\n  User ${sshUser}\n  ProxyCommand cloudflared access ssh --hostname %h\n  StrictHostKeyChecking no\n  UserKnownHostsFile /dev/null`

const directSshConfig = (host: string, sshPort: number, sshUser: string): string =>
  `Host ${host}-ssh\n  HostName ${host}\n  Port ${sshPort}\n  User ${sshUser}\n  StrictHostKeyChecking no\n  UserKnownHostsFile /dev/null`

const copyText = (text: string): void => {
  void navigator.clipboard.writeText(text)
}

const codeStyle: CSSProperties = {
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

const copyBtnStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#7fdfff",
  cursor: "pointer",
  font: "inherit",
  fontSize: "0.85em",
  fontWeight: "bold",
  padding: "2px 6px"
}

const linkStyle: CSSProperties = {
  color: "#56f39a",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "inherit",
  fontWeight: "bold",
  textDecoration: "none"
}

const panelOuterStyle: CSSProperties = {
  background: "#0d1520",
  border: "1px solid #2a4060",
  borderRadius: "4px",
  boxSizing: "border-box",
  height: "100%",
  overflowY: "auto",
  padding: "12px 16px"
}

const panelHeaderStyle: CSSProperties = {
  alignItems: "center",
  display: "flex",
  justifyContent: "space-between",
  marginBottom: "10px"
}

const buildVsCodeAccessValues = (cfState: CfTunnelState, info: VsCodeAccessInfo): VsCodeAccessValues => {
  const directHost = location.hostname
  const cfSshCommand = cfState.tag === "ready"
    ? `ssh -o "ProxyCommand=cloudflared access ssh --hostname %h" ${info.sshUser}@${cfState.hostname}`
    : null
  const cfVscodeUri = cfState.tag === "ready"
    ? `vscode://ms-vscode-remote.remote-ssh/open?hostName=${
      encodeURIComponent(`${info.sshUser}@${cfState.hostname}`)
    }&folder=${encodeURIComponent(info.targetDir)}`
    : null
  return {
    cfSshConfig: cfState.tag === "ready" ? hostSshConfig(cfState.hostname, info.sshUser) : null,
    cfSshCommand,
    cfVscodeUri,
    directConfig: directSshConfig(directHost, info.sshPort, info.sshUser),
    directCommand: String
      .raw`ssh -p ${info.sshPort} -t ${info.sshUser}@${directHost} "cd ${info.targetDir} && exec \$SHELL"`,
    directVscodeUri: `vscode://ms-vscode-remote.remote-ssh/open?hostName=${
      encodeURIComponent(`${directHost}-ssh`)
    }&folder=${encodeURIComponent(info.targetDir)}`
  }
}

const CodeCopyRow = ({ text }: { readonly text: string }): JSX.Element => (
  <>
    <code style={codeStyle}>{text}</code>
    <button
      onClick={() => {
        copyText(text)
      }}
      style={copyBtnStyle}
      type="button"
    >
      copy
    </button>
  </>
)

const CfTunnelFailedSection = ({ onRetry }: { readonly onRetry: () => void }): JSX.Element => (
  <div style={{ marginTop: "8px" }}>
    <div style={{ color: "#f87171" }}>Tunnel failed to start.</div>
    <button onClick={onRetry} style={{ ...copyBtnStyle, color: "#7fdfff", marginTop: "4px" }} type="button">
      Retry
    </button>
  </div>
)

const CfReadyDetails = (
  { cfSshCommand, cfSshConfig, cfVscodeUri, sshPassword }: CfReadyDetailsProps
): JSX.Element => (
  <>
    <div style={{ color: "#8be9fd", fontSize: "0.9em", fontWeight: "bold" }}>Add to ~/.ssh/config</div>
    <div style={{ color: "#8fa6c4", fontSize: "0.78em" }}>
      requires <code style={{ color: "#a8c8f0" }}>cloudflared</code> installed on your machine
    </div>
    <CodeCopyRow text={cfSshConfig} />
    <div style={{ color: "#8be9fd", fontSize: "0.9em", fontWeight: "bold", marginTop: "10px" }}>Connect via SSH</div>
    <CodeCopyRow text={cfSshCommand} />
    <div style={{ color: "#8be9fd", fontSize: "0.9em", fontWeight: "bold", marginTop: "10px" }}>SSH password</div>
    <CodeCopyRow text={sshPassword} />
    {cfVscodeUri !== null && (
      <>
        <div style={{ color: "#8be9fd", fontSize: "0.9em", fontWeight: "bold", marginTop: "10px" }}>
          Open in VS Code
        </div>
        <div style={{ marginTop: "4px" }}>
          <a href={cfVscodeUri} style={linkStyle}>open in VS Code (CF tunnel)</a>
        </div>
      </>
    )}
  </>
)

const DirectSshSection = (
  { cfReadyPassword, directCommand, directConfig, directVscodeUri }: DirectSshSectionProps
): JSX.Element => (
  <>
    <div style={{ borderTop: "1px solid #2a4060", margin: "14px 0 10px" }} />
    <div style={{ color: "#8be9fd", fontWeight: "bold", marginBottom: "8px" }}>Direct SSH (local network)</div>
    <div style={{ color: "#8be9fd", fontSize: "0.9em", fontWeight: "bold" }}>Add to ~/.ssh/config</div>
    <div style={{ color: "#8fa6c4", fontSize: "0.78em" }}>no cloudflared needed — works on same LAN</div>
    <CodeCopyRow text={directConfig} />
    <div style={{ color: "#8be9fd", fontSize: "0.9em", fontWeight: "bold", marginTop: "10px" }}>Connect via SSH</div>
    <CodeCopyRow text={directCommand} />
    {cfReadyPassword !== null && (
      <>
        <div style={{ color: "#8be9fd", fontSize: "0.9em", fontWeight: "bold", marginTop: "10px" }}>SSH password</div>
        <CodeCopyRow text={cfReadyPassword} />
      </>
    )}
    <div style={{ color: "#8be9fd", fontSize: "0.9em", fontWeight: "bold", marginTop: "10px" }}>Open in VS Code</div>
    <div style={{ color: "#8fa6c4", fontSize: "0.78em" }}>requires config entry above in ~/.ssh/config</div>
    <div style={{ marginTop: "4px" }}>
      <a href={directVscodeUri} style={linkStyle}>open in VS Code (direct)</a>
    </div>
  </>
)

export const VsCodeAccessPanel = (
  { cfState, info, onClose, onRefresh, onRetry }: VsCodeAccessPanelProps
): JSX.Element => {
  const vals = buildVsCodeAccessValues(cfState, info)
  return (
    <div style={panelOuterStyle}>
      <div style={panelHeaderStyle}>
        <div style={{ color: "#8be9fd", fontWeight: "bold" }}>VS Code / SSH access</div>
        <div style={{ display: "flex", gap: "4px" }}>
          {cfState.tag === "ready" && (
            <button onClick={onRefresh} style={{ ...copyBtnStyle, color: "#7fdfff" }} type="button">↻ refresh</button>
          )}
          <button onClick={onClose} style={{ ...copyBtnStyle, color: "#f87171" }} type="button">✕ close</button>
        </div>
      </div>
      {cfState.tag === "loading" && (
        <div style={{ color: "#8fa6c4", marginTop: "8px" }}>Starting Cloudflare tunnel…</div>
      )}
      {cfState.tag === "failed" && <CfTunnelFailedSection onRetry={onRetry} />}
      {cfState.tag === "ready" && vals.cfSshConfig !== null && vals.cfSshCommand !== null && (
        <CfReadyDetails
          cfSshConfig={vals.cfSshConfig}
          cfSshCommand={vals.cfSshCommand}
          cfVscodeUri={vals.cfVscodeUri}
          sshPassword={cfState.sshPassword}
        />
      )}
      <DirectSshSection
        cfReadyPassword={cfState.tag === "ready" ? cfState.sshPassword : null}
        directCommand={vals.directCommand}
        directConfig={vals.directConfig}
        directVscodeUri={vals.directVscodeUri}
      />
    </div>
  )
}
