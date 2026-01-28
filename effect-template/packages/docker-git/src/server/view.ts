import { Match } from "effect"

import type { ProjectIssue, ProjectSummary, ProjectsIndex } from "./core/domain.js"
import { findEnvValue } from "./core/env.js"

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")

const renderIssue = (issue: ProjectIssue): string =>
  Match.value(issue).pipe(
    Match.when({ _tag: "ConfigNotFound" }, ({ id, path }) =>
      `<div class="issue-card"><strong>${escapeHtml(id)}</strong> — missing config at <span class="mono">${escapeHtml(path)}</span></div>`
    ),
    Match.when({ _tag: "ConfigDecode" }, ({ id, message }) =>
      `<div class="issue-card"><strong>${escapeHtml(id)}</strong> — ${escapeHtml(message)}</div>`
    ),
    Match.exhaustive
  )

const formatPathStatus = (value: string, exists: boolean): string =>
  exists ? value : `${value} (missing)`

const renderProject = (project: ProjectSummary): string => `
  <article class="card">
    <div>
      <span class="badge">${escapeHtml(project.serviceName)}</span>
    </div>
    <h3>${escapeHtml(project.id)}</h3>
    <div class="meta">
      <div>Repo: <span>${escapeHtml(project.repoUrl)}</span></div>
      <div>Ref: <span>${escapeHtml(project.repoRef)}</span></div>
      <div>Container: <span>${escapeHtml(project.containerName)}</span></div>
      <div>Workspace: <span>${escapeHtml(project.targetDir)}</span></div>
      <div>SSH: <span>${escapeHtml(project.sshUser)}@${escapeHtml(project.sshHost)}:${project.sshPort}</span></div>
      <div>Env: <span>${escapeHtml(formatPathStatus(project.envGlobalPath, project.envGlobalExists))}</span></div>
      <div>Env (project): <span>${escapeHtml(formatPathStatus(project.envProjectPath, project.envProjectExists))}</span></div>
      <div class="deploy-line">
        <span>Deploy:</span>
        <span
          class="deploy-badge deploy-badge--idle"
          data-deploy-status
          data-project-id="${escapeHtml(project.id)}"
        >idle</span>
        <span class="deploy-message" data-deploy-message data-project-id="${escapeHtml(project.id)}"></span>
      </div>
    </div>
    <div class="code">${escapeHtml(project.sshCommand)}</div>
    <div class="actions">
      <form method="post" action="/actions/${encodeURIComponent(project.id)}/up" data-action="up" data-project-id="${escapeHtml(project.id)}">
        <button class="btn primary" type="submit">Up</button>
      </form>
      <form method="post" action="/actions/${encodeURIComponent(project.id)}/down" data-action="down" data-project-id="${escapeHtml(project.id)}">
        <button class="btn" type="submit">Down</button>
      </form>
      <form method="post" action="/actions/${encodeURIComponent(project.id)}/recreate" data-action="recreate" data-project-id="${escapeHtml(project.id)}">
        <button class="btn" type="submit">Recreate</button>
      </form>
      <a class="btn" href="/env/${encodeURIComponent(project.id)}">Env</a>
      <a class="btn" href="/terminal/${encodeURIComponent(project.id)}">Terminal</a>
      <a class="btn ghost" href="/deployments/${encodeURIComponent(project.id)}/logs">Deploy logs</a>
      <a class="btn ghost" href="/projects/${encodeURIComponent(project.id)}/ps">PS</a>
      <a class="btn ghost" href="/projects/${encodeURIComponent(project.id)}/logs">Logs</a>
    </div>
  </article>
`

// CHANGE: render the dashboard HTML from the projects index
// WHY: keep the UI deterministic without client-side scripting
// QUOTE(ТЗ): "Просто сделай сайт и бекенд приложение"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall index: render(index) -> html(index)
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: escaped user-provided strings
// COMPLEXITY: O(n) where n = |projects|
export const renderDashboard = (index: ProjectsIndex, notice?: string): string => {
  const issues = index.issues.length > 0
    ? `
      <section class="issues">
        <h2>Config issues</h2>
        <div class="issues-list">${index.issues.map(renderIssue).join("\n")
}</div>
      </section>
    `
    : ""

  const noticeBlock = notice
    ? `<section class="issues"><div class="issue-card">${escapeHtml(notice)}</div></section>`
    : ""

  const projects = index.projects.length > 0
    ? index.projects.map(renderProject).join("\n")
    : `<div class="card"><h3>No projects yet</h3><p class="muted">Create a docker-git project to populate this list.</p></div>`

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>docker-git orchestrator</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div class="scene">
      <header class="hero">
        <div class="brand">
          <div class="logo">dg</div>
          <div>
            <p class="eyebrow">docker-git</p>
            <h1>Orchestrator</h1>
            <p class="subtitle">Manage dev containers, SSH access, and repo lifecycle.</p>
          </div>
        </div>
        <div class="hero-actions">
          <a class="btn primary" href="/clone">Clone repo</a>
          <a class="btn primary" href="/">Refresh</a>
          <a class="btn" href="/integrations">Integrations</a>
          <div class="status">Root ${escapeHtml(index.root)}</div>
        </div>
      </header>

      <section class="summary">
        <div class="stat">
          <span class="label">Projects root</span>
          <span class="value">${escapeHtml(index.root)}</span>
        </div>
        <div class="stat">
          <span class="label">Projects</span>
          <span class="value">${index.projects.length}</span>
        </div>
        <div class="stat">
          <span class="label">Issues</span>
          <span class="value">${index.issues.length}</span>
        </div>
      </section>

      ${noticeBlock}
      ${issues}

      <section class="projects">
        <div class="section-head">
          <h2>Projects</h2>
          <p class="muted">Each card maps to one docker-git environment.</p>
        </div>
        <div class="project-grid">${projects}</div>
      </section>
    </div>
    <script type="module" src="/deploy.js"></script>
  </body>
</html>`
}

// CHANGE: render command output pages for logs/ps
// WHY: provide human-readable command output in the browser
// QUOTE(ТЗ): "видеть всю инфу по ним"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall output: render(output) -> html(output)
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: output is escaped
// COMPLEXITY: O(n) where n = |output|
export const renderOutputPage = (title: string, output: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div class="scene">
      <header class="hero">
        <div class="brand">
          <div class="logo">dg</div>
          <div>
            <p class="eyebrow">docker-git</p>
            <h1>${escapeHtml(title)}</h1>
            <p class="subtitle">Command output snapshot.</p>
          </div>
        </div>
        <div class="hero-actions">
          <a class="btn primary" href="/">Back</a>
        </div>
      </header>
      <section class="output">
        <pre class="output-body">${escapeHtml(output.trim().length === 0 ? "(no output)" : output)}</pre>
      </section>
    </div>
  </body>
</html>`

// CHANGE: render deployment logs page with live refresh hooks
// WHY: show progress for long-running builds without manual reloads
// QUOTE(ТЗ): "ОН как показывал так и показывает"
// REF: user-request-2026-01-15
// SOURCE: n/a
// FORMAT THEOREM: forall output: render(output) -> html(output)
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: output is escaped
// COMPLEXITY: O(n) where n = |output|
export const renderDeployLogsPage = (
  projectId: string,
  output: string,
  phase: string,
  message: string,
  updatedAt: string
): string => {
  const phaseClass = Match.value(phase).pipe(
    Match.when("down", () => "deploy-badge--down"),
    Match.when("build", () => "deploy-badge--build"),
    Match.when("up", () => "deploy-badge--up"),
    Match.when("running", () => "deploy-badge--running"),
    Match.when("error", () => "deploy-badge--error"),
    Match.orElse(() => "deploy-badge--idle")
  )

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>deploy logs</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div class="scene">
      <header class="hero">
        <div class="brand">
          <div class="logo">dg</div>
          <div>
            <p class="eyebrow">docker-git</p>
            <h1>deploy logs</h1>
            <p class="subtitle">Command output snapshot.</p>
          </div>
        </div>
        <div class="hero-actions">
          <a class="btn primary" href="/">Back</a>
        </div>
      </header>
      <section class="output">
        <div class="deploy-line output-meta">
          <span class="badge">${escapeHtml(projectId)}</span>
          <span
            class="deploy-badge ${phaseClass}"
            data-deploy-status
            data-project-id="${escapeHtml(projectId)}"
          >${escapeHtml(phase.length === 0 ? "idle" : phase)}</span>
          <span
            class="deploy-message"
            data-deploy-message
            data-project-id="${escapeHtml(projectId)}"
          >${escapeHtml(message)}</span>
          <span
            class="muted"
            data-deploy-updated
            data-project-id="${escapeHtml(projectId)}"
          >${escapeHtml(updatedAt)}</span>
        </div>
        <pre class="output-body" data-deploy-log data-project-id="${escapeHtml(projectId)}">${escapeHtml(
          output.trim().length === 0 ? "(no output)" : output
        )}</pre>
      </section>
    </div>
    <script type="module" src="/deploy-logs.js"></script>
  </body>
</html>`
}

// CHANGE: render the terminal connection page for a project
// WHY: enable in-browser terminal access to the container via SSH
// QUOTE(ТЗ): "Сделай что бы я сразу от сюда мог подключаться к терминалу"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall project: render(project) -> html(project)
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: escaped user-provided strings
// COMPLEXITY: O(1)
export const renderTerminalPage = (project: ProjectSummary, terminalPort: number): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Terminal — ${escapeHtml(project.id)}</title>
    <link rel="stylesheet" href="/styles.css" />
    <link rel="stylesheet" href="/vendor/xterm.css" />
  </head>
  <body>
    <div class="scene">
      <header class="hero">
        <div class="brand">
          <div class="logo">dg</div>
          <div>
            <p class="eyebrow">docker-git</p>
            <h1>Terminal</h1>
            <p class="subtitle">${escapeHtml(project.id)} · ${escapeHtml(project.repoUrl)}</p>
          </div>
        </div>
        <div class="hero-actions">
          <a class="btn primary" href="/">Back</a>
          <div class="status">SSH ${escapeHtml(project.sshUser)}@${escapeHtml(project.sshHost)}:${project.sshPort}</div>
        </div>
      </header>
      <section class="output">
        <div id="terminal" class="terminal" data-project-id="${escapeHtml(project.id)}" data-ws-port="${escapeHtml(String(terminalPort))}"></div>
      </section>
    </div>
    <script src="/vendor/xterm.js"></script>
    <script type="module" src="/terminal.js"></script>
  </body>
</html>`

// CHANGE: render Codex CLI login session page
// WHY: allow device auth to run inside the orchestrator UI
// QUOTE(ТЗ): "Мне нужна прямо нативная интеграция с Codex"
// REF: user-request-2026-01-10
// SOURCE: n/a
// FORMAT THEOREM: forall l: render(l) -> html(l)
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: label is normalized to a non-empty value
// COMPLEXITY: O(1)
export const renderCodexLoginPage = (label: string | null, terminalPort: number): string => {
  const safeLabel = label && label.trim().length > 0 ? label.trim() : "default"
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Codex Login — ${escapeHtml(safeLabel)}</title>
    <link rel="stylesheet" href="/styles.css" />
    <link rel="stylesheet" href="/vendor/xterm.css" />
  </head>
  <body>
    <div class="scene">
      <header class="hero">
        <div class="brand">
          <div class="logo">dg</div>
          <div>
            <p class="eyebrow">docker-git</p>
            <h1>Codex Login</h1>
            <p class="subtitle">Account · ${escapeHtml(safeLabel)}</p>
          </div>
        </div>
        <div class="hero-actions">
          <a class="btn primary" href="/integrations">Back</a>
          <div class="status">Device auth</div>
        </div>
      </header>
      <section class="output">
        <div
          id="terminal"
          class="terminal"
          data-codex-label="${escapeHtml(safeLabel)}"
          data-ws-port="${escapeHtml(String(terminalPort))}"
        ></div>
      </section>
    </div>
    <script src="/vendor/xterm.js"></script>
    <script type="module" src="/terminal.js"></script>
  </body>
</html>`
}

// CHANGE: render integrations page for shared credentials
// WHY: allow GitHub access configuration without entering containers
// QUOTE(ТЗ): "у меня должна быть возможность подключать гитхаб"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall s: render(s) -> html(s)
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: escaped user-provided strings
// COMPLEXITY: O(1)
export type GithubAccountView =
  | { readonly _tag: "Connected"; readonly label: string; readonly login: string }
  | { readonly _tag: "Error"; readonly label: string; readonly message: string }

export interface CodexAccountView {
  readonly label: string
  readonly path: string
  readonly connected: boolean
  readonly entries: number
  readonly legacy: boolean
}

const renderGithubAccounts = (accounts: ReadonlyArray<GithubAccountView>): string => {
  if (accounts.length === 0) {
    return `<div>Accounts: <span>none</span></div>`
  }

  return accounts
    .map((account) =>
      account._tag === "Connected"
        ? `<div>Account: <span>${escapeHtml(account.label)} · ${escapeHtml(account.login)}</span></div>`
        : `<div>Account: <span>${escapeHtml(account.label)} · error</span></div>`
    )
    .join("\n")
}

const renderGithubDisconnectForms = (accounts: ReadonlyArray<GithubAccountView>): string => {
  if (accounts.length === 0) {
    return ""
  }

  return accounts
    .map((account) =>
      `<form method="post" action="/integrations/github/disconnect" class="env-actions">
        <input type="hidden" name="githubLabel" value="${escapeHtml(account.label)}" />
        <button class="btn" type="submit">Disconnect ${escapeHtml(account.label)}</button>
      </form>`
    )
    .join("\n")
}

const findGithubLogin = (
  accounts: ReadonlyArray<GithubAccountView>,
  label: string
): string | null => {
  const match = accounts.find(
    (account) => account._tag === "Connected" && account.label === label
  )
  return match && match._tag === "Connected" ? match.login : null
}

const renderGithubActiveLine = (
  accounts: ReadonlyArray<GithubAccountView>,
  activeLabel: string | null
): string => {
  if (activeLabel === null) {
    return `<div>Active: <span>none</span></div>`
  }
  const login = findGithubLogin(accounts, activeLabel)
  const suffix = login ? ` · ${escapeHtml(login)}` : ""
  return `<div>Active: <span>${escapeHtml(activeLabel)}${suffix}</span></div>`
}

const renderGithubAccountOptions = (accounts: ReadonlyArray<GithubAccountView>): string => {
  if (accounts.length === 0) {
    return `<option value="" disabled selected>No accounts connected</option>`
  }

  return accounts
    .map((account) =>
      account._tag === "Connected"
        ? `<option value="${escapeHtml(account.label)}">${escapeHtml(account.label)} · ${escapeHtml(account.login)}</option>`
        : `<option value="${escapeHtml(account.label)}" disabled>${escapeHtml(account.label)} · error</option>`
    )
    .join("\n")
}

const renderGithubAccountOptionsForClone = (accounts: ReadonlyArray<GithubAccountView>): string => {
  const base = `<option value="" selected>Public repo (no token)</option>`
  if (accounts.length === 0) {
    return base
  }

  const options = accounts
    .map((account) =>
      account._tag === "Connected"
        ? `<option value="${escapeHtml(account.label)}">${escapeHtml(account.label)} · ${escapeHtml(account.login)}</option>`
        : `<option value="${escapeHtml(account.label)}" disabled>${escapeHtml(account.label)} · error</option>`
    )
    .join("\n")

  return `${base}
${options}`
}

const renderCodexAccounts = (accounts: ReadonlyArray<CodexAccountView>): string => {
  if (accounts.length === 0) {
    return `<div>Accounts: <span>none</span></div>`
  }

  return accounts
    .map((account) => {
      const legacyTag = account.legacy ? " · legacy" : ""
      const status = account.connected ? "connected" : "empty"
      return `<div>Account: <span>${escapeHtml(account.label)}${legacyTag} · ${status}</span></div>`
    })
    .join("\n")
}

const renderCodexDisconnectForms = (accounts: ReadonlyArray<CodexAccountView>): string => {
  if (accounts.length === 0) {
    return ""
  }

  return accounts
    .map((account) =>
      `<form method="post" action="/integrations/codex/disconnect" class="env-actions">
        <input type="hidden" name="codexLabel" value="${escapeHtml(account.label)}" />
        <button class="btn" type="submit">Disconnect ${escapeHtml(account.label)}</button>
      </form>`
    )
    .join("\n")
}

const renderCodexAccountOptions = (accounts: ReadonlyArray<CodexAccountView>): string => {
  if (accounts.length === 0) {
    return `<option value="" disabled selected>No accounts connected</option>`
  }

  return accounts
    .map((account) => {
      const legacyTag = account.legacy ? " · legacy" : ""
      return account.connected
        ? `<option value="${escapeHtml(account.label)}">${escapeHtml(account.label)}${legacyTag}</option>`
        : `<option value="${escapeHtml(account.label)}" disabled>${escapeHtml(account.label)}${legacyTag} · empty</option>`
    })
    .join("\n")
}

const renderCodexActiveLine = (
  accounts: ReadonlyArray<CodexAccountView>,
  activeLabel: string | null
): string => {
  if (activeLabel === null) {
    return `<div>Active: <span>none</span></div>`
  }
  const match = accounts.find((account) => account.label === activeLabel)
  const legacyTag = match?.legacy ? " · legacy" : ""
  return `<div>Active: <span>${escapeHtml(activeLabel)}${legacyTag}</span></div>`
}

export const renderIntegrationsPage = (
  globalEnvPath: string,
  githubAccounts: ReadonlyArray<GithubAccountView>,
  codexRootPath: string,
  codexAccounts: ReadonlyArray<CodexAccountView>
): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Integrations</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div class="scene">
      <header class="hero">
        <div class="brand">
          <div class="logo">dg</div>
          <div>
            <p class="eyebrow">docker-git</p>
            <h1>Integrations</h1>
            <p class="subtitle">Connect shared services for private repos and CLIs.</p>
          </div>
        </div>
        <div class="hero-actions">
          <a class="btn primary" href="/">Back</a>
          <div class="status">Global env ${escapeHtml(globalEnvPath)}</div>
        </div>
      </header>

      <section class="projects">
        <div class="project-grid">
          <article class="card">
            <div>
              <span class="badge">github</span>
            </div>
            <h3>GitHub</h3>
            <div class="meta">
              <div>Status: <span>${githubAccounts.length > 0 ? "Connected" : "Not connected"}</span></div>
              ${renderGithubAccounts(githubAccounts)}
            </div>
            <div class="env-actions env-actions--left">
              <a
                class="btn ghost"
                href="https://github.com/settings/tokens/new?description=gitingest&scopes=repo,read:audit_log,write:discussion,read:project"
                target="_blank"
                rel="noreferrer"
              >Get GitHub token</a>
            </div>
            <form method="post" action="/integrations/github/connect" class="env-actions">
              <input class="env-input" type="text" name="githubLabel" placeholder="label (optional)" />
              <input class="env-input" type="password" name="githubToken" placeholder="ghp_..." required />
              <button class="btn primary" type="submit">Connect</button>
            </form>
            ${renderGithubDisconnectForms(githubAccounts)}
          </article>
          <article class="card">
            <div>
              <span class="badge">codex</span>
            </div>
            <h3>Codex</h3>
            <div class="meta">
              <div>Status: <span>${codexAccounts.length > 0 ? "Connected" : "Not connected"}</span></div>
              <div>Auth root: <span class="mono">${escapeHtml(codexRootPath)}</span></div>
              ${renderCodexAccounts(codexAccounts)}
            </div>
            <div class="env-actions env-actions--left">
              <a
                class="btn ghost"
                href="https://developers.openai.com/codex/auth/"
                target="_blank"
                rel="noreferrer"
              >Open Codex auth docs</a>
            </div>
            <form method="post" action="/integrations/codex/login" class="env-actions">
              <input class="env-input" type="text" name="codexLabel" placeholder="label (optional)" />
              <button class="btn primary" type="submit">Login with Codex CLI</button>
            </form>
            <form method="post" action="/integrations/codex/connect" class="env-actions">
              <input class="env-input" type="text" name="codexLabel" placeholder="label (optional)" />
              <input class="env-input" type="text" name="codexSource" placeholder="~/.codex" />
              <button class="btn primary" type="submit">Import</button>
            </form>
            ${renderCodexDisconnectForms(codexAccounts)}
          </article>
        </div>
      </section>
    </div>
  </body>
</html>`

// CHANGE: render clone form for creating new docker-git projects
// WHY: allow cloning repositories from the UI with a selected GitHub session
// QUOTE(ТЗ): "Добавь на нашу платформу кнопку склонировать репозиторий"
// REF: user-request-2026-01-13
// SOURCE: n/a
// FORMAT THEOREM: forall accounts: render(accounts) -> html(accounts)
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: escaped user-provided strings
// COMPLEXITY: O(n) where n = |accounts|
export const renderClonePage = (
  globalEnvPath: string,
  githubAccounts: ReadonlyArray<GithubAccountView>
): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Clone repository</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div class="scene">
      <header class="hero">
        <div class="brand">
          <div class="logo">dg</div>
          <div>
            <p class="eyebrow">docker-git</p>
            <h1>Clone repository</h1>
            <p class="subtitle">Spin up a container and clone the repo into it.</p>
          </div>
        </div>
        <div class="hero-actions">
          <a class="btn primary" href="/">Back</a>
          <div class="status">Global env ${escapeHtml(globalEnvPath)}</div>
        </div>
      </header>

      <section class="projects">
        <div class="project-grid">
          <article class="card">
            <div>
              <span class="badge">clone</span>
            </div>
            <h3>New docker-git project</h3>
            <div class="meta">
              <div>Git session: <span>select a GitHub account for private repos</span></div>
            </div>
            <form method="post" action="/clone" class="env-actions env-actions--left">
              <input class="env-input" type="text" name="repoUrl" placeholder="https://github.com/org/repo" required />
              <input class="env-input" type="text" name="repoRef" placeholder="main (optional)" />
              <select class="env-select" name="githubLabel">
                ${renderGithubAccountOptionsForClone(githubAccounts)}
              </select>
              <button class="btn primary" type="submit">Clone</button>
            </form>
            <div class="env-note">
              <p class="muted">For private repos, pick a connected GitHub account from Integrations.</p>
              <p class="muted">Public repos can be cloned without a token.</p>
            </div>
          </article>
        </div>
      </section>
    </div>
  </body>
</html>`

// CHANGE: render GitHub token instructions page
// WHY: provide a single link that embeds the required token guidance
// QUOTE(ТЗ): "генерировать такую ссылку которая автоматически подствит всё что необходимо"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall _: render() -> html()
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: escaped user-provided strings
// COMPLEXITY: O(1)
export const renderGithubTokenHelpPage = (): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GitHub token</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div class="scene">
      <header class="hero">
        <div class="brand">
          <div class="logo">dg</div>
          <div>
            <p class="eyebrow">docker-git</p>
            <h1>GitHub token</h1>
            <p class="subtitle">Create a PAT for clone + push.</p>
          </div>
        </div>
        <div class="hero-actions">
          <a class="btn primary" href="/integrations">Back</a>
        </div>
      </header>

      <section class="output env-editor">
        <div class="env-note">
          <p class="muted">To clone + push, the token must allow write access to repository contents.</p>
          <p class="muted">Classic PAT: select <span class="mono">repo</span>. Fine-grained PAT: Repository permissions → Contents: Read &amp; write.</p>
        </div>
        <div class="env-actions env-actions--left">
          <a class="btn primary" href="https://github.com/settings/tokens/new?description=gitingest&scopes=repo,read:audit_log,write:discussion,read:project" target="_blank" rel="noreferrer">Open GitHub token page</a>
        </div>
        <p class="muted">Direct link: <a class="mono link" href="https://github.com/settings/tokens/new?description=gitingest&scopes=repo,read:audit_log,write:discussion,read:project" target="_blank" rel="noreferrer">github.com/settings/tokens/new?description=gitingest&amp;scopes=repo,read:audit_log,write:discussion,read:project</a></p>
      </section>
    </div>
  </body>
</html>`

interface GitIdentityView {
  readonly projectName: string | null
  readonly projectEmail: string | null
  readonly effectiveName: string | null
  readonly effectiveEmail: string | null
}

// CHANGE: resolve git identity from env files
// WHY: surface git config status and allow editing in the UI
// QUOTE(ТЗ): "почему у нас не задаётся гит конфиг автоматически?"
// REF: user-request-2026-01-14
// SOURCE: n/a
// FORMAT THEOREM: forall env: effective = project ?? global
// PURITY: CORE
// EFFECT: Effect<GitIdentityView, never, never>
// INVARIANT: project env overrides global env
// COMPLEXITY: O(n) where n = |lines|
const resolveGitIdentity = (globalEnv: string, projectEnv: string): GitIdentityView => {
  const projectName = findEnvValue(projectEnv, "GIT_USER_NAME")
  const projectEmail = findEnvValue(projectEnv, "GIT_USER_EMAIL")
  const globalName = findEnvValue(globalEnv, "GIT_USER_NAME")
  const globalEmail = findEnvValue(globalEnv, "GIT_USER_EMAIL")
  return {
    projectName,
    projectEmail,
    effectiveName: projectName ?? globalName,
    effectiveEmail: projectEmail ?? globalEmail
  }
}

const renderOptionalValue = (value: string | null): string =>
  value === null ? `<span class="muted">not set</span>` : `<span>${escapeHtml(value)}</span>`

// CHANGE: render env editor page for a project
// WHY: allow shared secrets and service tokens to be managed in one place
// QUOTE(ТЗ): "удобную настройку ENV"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall env: render(env) -> html(env)
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: escaped user-provided strings
// COMPLEXITY: O(n) where n = |env|
export const renderEnvPage = (
  project: ProjectSummary,
  globalEnv: string,
  projectEnv: string,
  githubAccounts: ReadonlyArray<GithubAccountView>,
  activeGithubLabel: string | null,
  codexAccounts: ReadonlyArray<CodexAccountView>,
  activeCodexLabel: string | null
): string => {
  const hasGithubAccounts = githubAccounts.some((account) => account._tag === "Connected")
  const githubSelect = renderGithubAccountOptions(githubAccounts)
  const githubActiveLine = renderGithubActiveLine(githubAccounts, activeGithubLabel)
  const codexHasAccounts = codexAccounts.some((account) => account.connected)
  const codexSelect = renderCodexAccountOptions(codexAccounts)
  const codexActiveLine = renderCodexActiveLine(codexAccounts, activeCodexLabel)
  const gitIdentity = resolveGitIdentity(globalEnv, projectEnv)
  const gitUserName = gitIdentity.projectName ?? ""
  const gitUserEmail = gitIdentity.projectEmail ?? ""
  const gitEffectiveName = renderOptionalValue(gitIdentity.effectiveName)
  const gitEffectiveEmail = renderOptionalValue(gitIdentity.effectiveEmail)

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Env — ${escapeHtml(project.id)}</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div class="scene">
      <header class="hero">
        <div class="brand">
          <div class="logo">dg</div>
          <div>
            <p class="eyebrow">docker-git</p>
            <h1>Env</h1>
            <p class="subtitle">${escapeHtml(project.id)} · ${escapeHtml(project.repoUrl)}</p>
          </div>
        </div>
        <div class="hero-actions">
          <a class="btn primary" href="/">Back</a>
          <div class="status">SSH ${escapeHtml(project.sshUser)}@${escapeHtml(project.sshHost)}:${project.sshPort}</div>
        </div>
      </header>

      <section class="output env-editor">
        <div class="service-panel">
          <div class="service-head">Services</div>
          <div class="service-card">
            <div class="service-row">
              <strong>GitHub</strong>
              ${githubActiveLine}
            </div>
            <form method="post" action="/env/${encodeURIComponent(project.id)}/connect/github" class="env-actions env-actions--left">
              <select class="env-select" name="githubLabel" ${hasGithubAccounts ? "" : "disabled"}>
                ${githubSelect}
              </select>
              <button class="btn primary" type="submit" ${hasGithubAccounts ? "" : "disabled"}>Use for this project</button>
            </form>
            <form method="post" action="/env/${encodeURIComponent(project.id)}/disconnect/github" class="env-actions env-actions--left">
              <button class="btn" type="submit">Disconnect git</button>
            </form>
          </div>
          <div class="service-card">
            <div class="service-row">
              <strong>Git identity</strong>
              <div>Effective name: ${gitEffectiveName}</div>
              <div>Effective email: ${gitEffectiveEmail}</div>
            </div>
            <form method="post" action="/env/${encodeURIComponent(project.id)}/git/identity" class="env-actions env-actions--left">
              <input class="env-input" type="text" name="gitUserName" placeholder="user.name" value="${escapeHtml(gitUserName)}" />
              <input class="env-input" type="email" name="gitUserEmail" placeholder="user@email.com" value="${escapeHtml(gitUserEmail)}" />
              <button class="btn primary" type="submit">Save git identity</button>
            </form>
            <p class="muted">Stored in project env. Leave empty to fall back to global env.</p>
          </div>
          <div class="service-card">
            <div class="service-row">
              <strong>Codex</strong>
              ${codexActiveLine}
            </div>
            <form method="post" action="/env/${encodeURIComponent(project.id)}/connect/codex" class="env-actions env-actions--left">
              <select class="env-select" name="codexLabel" ${codexHasAccounts ? "" : "disabled"}>
                ${codexSelect}
              </select>
              <button class="btn primary" type="submit" ${codexHasAccounts ? "" : "disabled"}>Use for this project</button>
            </form>
            <form method="post" action="/env/${encodeURIComponent(project.id)}/disconnect/codex" class="env-actions env-actions--left">
              <button class="btn" type="submit">Disconnect codex</button>
            </form>
          </div>
        </div>
        <form method="post" action="/env/${encodeURIComponent(project.id)}">
          <div class="env-grid">
            <div class="env-block">
              <label class="env-label">Global env</label>
              <p class="muted env-hint">Shared across all containers. Path: <span class="mono">${escapeHtml(project.envGlobalPath)}</span></p>
              <textarea class="env-textarea" name="globalEnv" spellcheck="false">${escapeHtml(globalEnv)}</textarea>
            </div>
            <div class="env-block">
              <label class="env-label">Project env</label>
              <p class="muted env-hint">Only for this project. Path: <span class="mono">${escapeHtml(project.envProjectPath)}</span></p>
              <textarea class="env-textarea" name="projectEnv" spellcheck="false">${escapeHtml(projectEnv)}</textarea>
            </div>
          </div>
          <div class="env-actions">
            <button class="btn primary" type="submit">Save</button>
          </div>
        </form>
        <div class="env-note">
          <p class="muted">Examples: <span class="mono">GITHUB_TOKEN</span>, <span class="mono">GIT_AUTH_TOKEN</span>, <span class="mono">GIT_USER_NAME</span>, <span class="mono">GIT_USER_EMAIL</span>.</p>
          <p class="muted">Private GitHub clone uses <span class="mono">GIT_AUTH_TOKEN</span> or <span class="mono">GITHUB_TOKEN</span>. Optional <span class="mono">GIT_AUTH_USER</span> (default: <span class="mono">x-access-token</span>).</p>
        </div>
      </section>
    </div>
  </body>
</html>`
}
