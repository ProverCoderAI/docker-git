export const uiStyles = `@import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap");

:root {
  --bg: #f6f7f9;
  --surface: rgba(255, 255, 255, 0.88);
  --surface-strong: #ffffff;
  --text: #12222f;
  --muted: #516574;
  --line: rgba(18, 34, 47, 0.14);
  --accent: #0466c8;
  --accent-2: #0096c7;
  --danger: #b42318;
  --ok: #117a65;
  --shadow: 0 16px 42px rgba(7, 31, 51, 0.12);
  --radius: 16px;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  font-family: "Space Grotesk", "Segoe UI", sans-serif;
  color: var(--text);
  background:
    radial-gradient(circle at 10% -10%, rgba(4, 102, 200, 0.18), transparent 45%),
    radial-gradient(circle at 90% 0%, rgba(0, 150, 199, 0.16), transparent 40%),
    linear-gradient(180deg, #fbfdff 0%, #f4f7fb 100%);
}

body {
  min-height: 100vh;
}

.app-shell {
  width: min(1260px, 100% - 2rem);
  margin: 1rem auto 2rem;
}

.hero {
  padding: 1rem 0;
}

.hero h1 {
  margin: 0;
  font-size: clamp(1.4rem, 2vw + 0.6rem, 2.2rem);
  letter-spacing: 0.01em;
}

.hero p {
  margin: 0.35rem 0 0;
  color: var(--muted);
}

.toolbar {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  align-items: center;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 0.8rem;
}

.toolbar input {
  flex: 1 1 260px;
}

.grid {
  display: grid;
  grid-template-columns: minmax(300px, 0.95fr) minmax(340px, 1.2fr);
  gap: 0.9rem;
  margin-top: 0.9rem;
}

.stack {
  display: grid;
  gap: 0.9rem;
}

.panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.6rem;
  padding: 0.72rem 0.85rem;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(135deg, rgba(4, 102, 200, 0.06), rgba(0, 150, 199, 0.04));
}

.panel-head h2,
.panel-head h3 {
  margin: 0;
  font-size: 1rem;
}

.panel-body {
  padding: 0.82rem;
}

label {
  font-size: 0.8rem;
  color: var(--muted);
  display: block;
  margin-bottom: 0.2rem;
}

input,
select,
textarea,
button {
  font: inherit;
}

input,
select,
textarea {
  width: 100%;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--surface-strong);
  padding: 0.52rem 0.6rem;
  color: var(--text);
}

textarea,
pre,
code,
.output,
.events {
  font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}

textarea {
  min-height: 88px;
  resize: vertical;
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.55rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

button {
  border: 0;
  border-radius: 999px;
  padding: 0.45rem 0.86rem;
  font-weight: 600;
  cursor: pointer;
  color: #fff;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
}

button[data-variant="ghost"] {
  color: var(--text);
  border: 1px solid var(--line);
  background: #fff;
}

button[data-variant="danger"] {
  background: linear-gradient(135deg, #b42318, #da3f34);
}

button[data-variant="ok"] {
  background: linear-gradient(135deg, #0c8a5c, #0d9d68);
}

button:disabled {
  opacity: 0.62;
  cursor: not-allowed;
}

.project-list {
  display: grid;
  gap: 0.45rem;
  max-height: 350px;
  overflow: auto;
}

.project-card {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 0.55rem;
  background: #fff;
}

.project-card.active {
  border-color: rgba(4, 102, 200, 0.5);
  box-shadow: 0 0 0 2px rgba(4, 102, 200, 0.12);
}

.project-card .top {
  display: flex;
  justify-content: space-between;
  gap: 0.4rem;
  align-items: center;
}

.badge {
  border-radius: 999px;
  padding: 0.1rem 0.5rem;
  font-size: 0.75rem;
  border: 1px solid var(--line);
  background: #fff;
}

.badge.running {
  color: var(--ok);
  border-color: rgba(17, 122, 101, 0.36);
  background: rgba(17, 122, 101, 0.1);
}

.badge.stopped {
  color: #9a4d04;
  border-color: rgba(154, 77, 4, 0.3);
  background: rgba(154, 77, 4, 0.11);
}

.kv {
  display: grid;
  grid-template-columns: 170px 1fr;
  gap: 0.3rem 0.6rem;
  font-size: 0.85rem;
}

.kv .k {
  color: var(--muted);
}

pre {
  margin: 0;
  white-space: pre-wrap;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #f9fcff;
  padding: 0.68rem;
  max-height: 240px;
  overflow: auto;
}

.events,
.output {
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #0f1a23;
  color: #d8e7f5;
  padding: 0.68rem;
  min-height: 130px;
  max-height: 260px;
  overflow: auto;
  white-space: pre-wrap;
  font-size: 0.8rem;
}

.agents {
  display: grid;
  gap: 0.6rem;
}

.agent-item {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0.56rem;
  background: #fff;
  display: grid;
  gap: 0.45rem;
}

.agent-item .top {
  display: flex;
  justify-content: space-between;
  gap: 0.4rem;
  align-items: center;
}

.small {
  font-size: 0.8rem;
  color: var(--muted);
}

.mono {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  word-break: break-word;
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.checkbox-row input {
  width: auto;
}

@media (max-width: 980px) {
  .grid {
    grid-template-columns: 1fr;
  }

  .row {
    grid-template-columns: 1fr;
  }

  .kv {
    grid-template-columns: 1fr;
  }
}
`

export const uiHtml = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>docker-git API Console</title>
    <link rel="stylesheet" href="/ui/styles.css" />
  </head>
  <body>
    <main class="app-shell">
      <section class="hero">
        <h1>docker-git API Console</h1>
        <p>UI-обвязка для тестирования v1 API без CLI</p>
      </section>

      <section class="toolbar">
        <div style="min-width:180px">
          <label for="base-url">Base URL</label>
          <input id="base-url" type="text" value="" placeholder="http://localhost:3334" />
        </div>
        <button id="btn-health" data-variant="ok">Health</button>
        <button id="btn-projects-refresh" data-variant="ghost">Обновить проекты</button>
      </section>

      <section class="grid">
        <div class="stack">
          <article class="panel">
            <header class="panel-head">
              <h2>Создать проект</h2>
            </header>
            <div class="panel-body">
              <div class="row">
                <div>
                  <label for="create-repo-url">Repo URL</label>
                  <input id="create-repo-url" type="text" placeholder="https://github.com/org/repo" />
                </div>
                <div>
                  <label for="create-repo-ref">Repo ref</label>
                  <input id="create-repo-ref" type="text" placeholder="main" />
                </div>
              </div>
              <div class="row" style="margin-top:0.5rem">
                <div>
                  <label for="create-ssh-port">SSH port (optional)</label>
                  <input id="create-ssh-port" type="text" placeholder="2222" />
                </div>
                <div>
                  <label for="create-network-mode">Network mode</label>
                  <select id="create-network-mode">
                    <option value="">default</option>
                    <option value="shared">shared</option>
                    <option value="project">project</option>
                  </select>
                </div>
              </div>
              <div class="checkbox-row" style="margin-top:0.6rem">
                <input id="create-up" type="checkbox" checked />
                <label for="create-up" style="margin:0">run up</label>
                <input id="create-force" type="checkbox" />
                <label for="create-force" style="margin:0">force</label>
                <input id="create-force-env" type="checkbox" />
                <label for="create-force-env" style="margin:0">force-env</label>
              </div>
              <div class="actions" style="margin-top:0.7rem">
                <button id="btn-create-project">Создать проект</button>
              </div>
            </div>
          </article>

          <article class="panel">
            <header class="panel-head">
              <h2>Проекты</h2>
              <span class="small" id="projects-count">0</span>
            </header>
            <div class="panel-body">
              <div class="project-list" id="projects-list"></div>
            </div>
          </article>
        </div>

        <div class="stack">
          <article class="panel">
            <header class="panel-head">
              <h2>Проект</h2>
              <span class="small mono" id="active-project-id">not selected</span>
            </header>
            <div class="panel-body">
              <div class="kv" id="project-details"></div>

              <div class="actions" style="margin-top:0.7rem">
                <button id="btn-up">Up</button>
                <button id="btn-down" data-variant="ghost">Down</button>
                <button id="btn-recreate">Recreate</button>
                <button id="btn-delete" data-variant="danger">Delete</button>
                <button id="btn-ps" data-variant="ghost">PS</button>
                <button id="btn-logs" data-variant="ghost">Logs</button>
              </div>

              <label for="project-output" style="margin-top:0.8rem">PS / Logs output</label>
              <pre id="project-output"></pre>

              <div class="actions" style="margin-top:0.8rem">
                <button id="btn-events-start" data-variant="ok">Start events</button>
                <button id="btn-events-stop" data-variant="ghost">Stop events</button>
              </div>
              <label for="events-log" style="margin-top:0.5rem">SSE events</label>
              <div class="events" id="events-log"></div>
            </div>
          </article>

          <article class="panel">
            <header class="panel-head">
              <h2>Агенты</h2>
              <button id="btn-agents-refresh" data-variant="ghost">Обновить</button>
            </header>
            <div class="panel-body">
              <div class="row">
                <div>
                  <label for="agent-provider">Provider</label>
                  <select id="agent-provider">
                    <option value="codex">codex</option>
                    <option value="opencode">opencode</option>
                    <option value="claude">claude</option>
                    <option value="custom">custom</option>
                  </select>
                </div>
                <div>
                  <label for="agent-label">Label</label>
                  <input id="agent-label" type="text" placeholder="debug session" />
                </div>
              </div>
              <div style="margin-top:0.5rem">
                <label for="agent-command">Command (optional for codex/opencode/claude)</label>
                <input id="agent-command" type="text" placeholder="codex --help" />
              </div>
              <div style="margin-top:0.5rem">
                <label for="agent-cwd">CWD inside container (optional)</label>
                <input id="agent-cwd" type="text" placeholder="/home/dev/app" />
              </div>
              <div style="margin-top:0.5rem">
                <label for="agent-env">Env (KEY=VALUE, по строкам)</label>
                <textarea id="agent-env" placeholder="FOO=bar"></textarea>
              </div>
              <div class="actions" style="margin-top:0.6rem">
                <button id="btn-agent-start">Запустить агента</button>
              </div>

              <div class="agents" id="agents-list" style="margin-top:0.8rem"></div>
            </div>
          </article>
        </div>
      </section>

      <section class="panel" style="margin-top:0.9rem">
        <header class="panel-head">
          <h3>Debug output</h3>
          <button id="btn-clear-output" data-variant="ghost">Очистить</button>
        </header>
        <div class="panel-body">
          <div class="output" id="debug-output"></div>
        </div>
      </section>
    </main>

    <script src="/ui/app.js"></script>
  </body>
</html>
`

export const uiScript = `
(() => {
  const state = {
    baseUrl: '',
    projectId: '',
    project: null,
    projects: [],
    agents: [],
    eventSource: null,
    eventCursor: 0
  };

  const byId = (id) => document.getElementById(id);

  const views = {
    baseUrl: byId('base-url'),
    projectsCount: byId('projects-count'),
    projectsList: byId('projects-list'),
    activeProjectId: byId('active-project-id'),
    projectDetails: byId('project-details'),
    projectOutput: byId('project-output'),
    eventsLog: byId('events-log'),
    debugOutput: byId('debug-output'),
    agentProvider: byId('agent-provider'),
    agentLabel: byId('agent-label'),
    agentCommand: byId('agent-command'),
    agentCwd: byId('agent-cwd'),
    agentEnv: byId('agent-env'),
    agentsList: byId('agents-list'),
    createRepoUrl: byId('create-repo-url'),
    createRepoRef: byId('create-repo-ref'),
    createSshPort: byId('create-ssh-port'),
    createNetworkMode: byId('create-network-mode'),
    createUp: byId('create-up'),
    createForce: byId('create-force'),
    createForceEnv: byId('create-force-env')
  };

  const appendDebug = (label, payload) => {
    const stamp = new Date().toISOString();
    const line = '[' + stamp + '] ' + label + '\\n' + (typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2));
    views.debugOutput.textContent = (line + '\\n\\n' + views.debugOutput.textContent).slice(0, 24000);
  };

  const normalizeBase = (value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      return window.location.origin;
    }
    return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  };

  const projectPath = (projectId, suffix) => '/v1/projects/' + encodeURIComponent(projectId) + suffix;

  const request = async (path, init) => {
    const base = normalizeBase(views.baseUrl.value);
    state.baseUrl = base;
    const url = base + path;
    const response = await fetch(url, init || {});
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_error) {
      json = { raw: text };
    }

    if (!response.ok) {
      appendDebug('HTTP ' + response.status + ' ' + path, json);
      throw new Error((json && json.error && json.error.message) || ('HTTP ' + response.status));
    }

    appendDebug('HTTP ' + response.status + ' ' + path, json || text);
    return json;
  };

  const setProjectOutput = (value) => {
    views.projectOutput.textContent = value || '';
  };

  const renderProjectDetails = () => {
    views.activeProjectId.textContent = state.projectId || 'not selected';
    if (!state.project) {
      views.projectDetails.innerHTML = '<div class="small">Выберите проект слева</div>';
      return;
    }

    const details = [
      ['displayName', state.project.displayName],
      ['repo', state.project.repoUrl + ' @ ' + state.project.repoRef],
      ['status', state.project.status + ' (' + state.project.statusLabel + ')'],
      ['container', state.project.containerName],
      ['service', state.project.serviceName],
      ['ssh', state.project.sshCommand],
      ['targetDir', state.project.targetDir]
    ];

    views.projectDetails.innerHTML = details.map(([k, v]) => '<div class="k">' + k + '</div><div class="mono">' + String(v) + '</div>').join('');
  };

  const renderProjects = () => {
    views.projectsCount.textContent = String(state.projects.length);
    if (state.projects.length === 0) {
      views.projectsList.innerHTML = '<div class="small">Проекты не найдены</div>';
      return;
    }

    views.projectsList.innerHTML = state.projects.map((item) => {
      const activeClass = item.id === state.projectId ? ' active' : '';
      const badgeClass = item.status === 'running' ? 'running' : (item.status === 'stopped' ? 'stopped' : '');
      return [
        '<div class="project-card' + activeClass + '">',
        '<div class="top">',
        '<strong>' + item.displayName + '</strong>',
        '<span class="badge ' + badgeClass + '">' + item.status + '</span>',
        '</div>',
        '<div class="small mono">' + item.repoRef + '</div>',
        '<div class="actions" style="margin-top:0.45rem"><button data-variant="ghost" data-project-id="' + item.id.replaceAll('"', '&quot;') + '">Выбрать</button></div>',
        '</div>'
      ].join('');
    }).join('');

    views.projectsList.querySelectorAll('button[data-project-id]').forEach((button) => {
      button.addEventListener('click', () => {
        selectProject(button.getAttribute('data-project-id') || '');
      });
    });
  };

  const loadProjects = async () => {
    const payload = await request('/v1/projects');
    state.projects = (payload && payload.projects) || [];
    renderProjects();

    if (!state.projectId && state.projects.length > 0) {
      await selectProject(state.projects[0].id);
    }
  };

  const loadProject = async () => {
    if (!state.projectId) {
      return;
    }
    const payload = await request(projectPath(state.projectId, ''));
    state.project = payload.project;
    renderProjectDetails();
  };

  const selectProject = async (projectId) => {
    if (!projectId) {
      return;
    }
    state.projectId = projectId;
    renderProjects();
    await loadProject();
    await loadAgents();
  };

  const loadAgents = async () => {
    if (!state.projectId) {
      views.agentsList.innerHTML = '<div class="small">Сначала выберите проект</div>';
      return;
    }

    const payload = await request(projectPath(state.projectId, '/agents'));
    state.agents = (payload && payload.sessions) || [];
    renderAgents();
  };

  const renderAgents = () => {
    if (!state.projectId) {
      views.agentsList.innerHTML = '<div class="small">Сначала выберите проект</div>';
      return;
    }

    if (state.agents.length === 0) {
      views.agentsList.innerHTML = '<div class="small">Агенты не запущены</div>';
      return;
    }

    views.agentsList.innerHTML = state.agents.map((agent) => {
      return [
        '<div class="agent-item">',
        '<div class="top">',
        '<strong>' + agent.label + '</strong>',
        '<span class="badge">' + agent.status + '</span>',
        '</div>',
        '<div class="small mono">' + agent.id + '</div>',
        '<div class="small mono">' + agent.command + '</div>',
        '<div class="actions">',
        '<button data-action="logs" data-agent-id="' + agent.id + '" data-variant="ghost">Logs</button>',
        '<button data-action="attach" data-agent-id="' + agent.id + '" data-variant="ghost">Attach</button>',
        '<button data-action="stop" data-agent-id="' + agent.id + '" data-variant="danger">Stop</button>',
        '</div>',
        '</div>'
      ].join('');
    }).join('');

    views.agentsList.querySelectorAll('button[data-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const action = button.getAttribute('data-action') || '';
        const agentId = button.getAttribute('data-agent-id') || '';
        if (!agentId || !state.projectId) {
          return;
        }

        if (action === 'stop') {
          await request(projectPath(state.projectId, '/agents/' + encodeURIComponent(agentId) + '/stop'), { method: 'POST' });
          await loadAgents();
          return;
        }

        if (action === 'logs') {
          const payload = await request(projectPath(state.projectId, '/agents/' + encodeURIComponent(agentId) + '/logs?lines=250'));
          const lines = (payload.entries || []).map((entry) => entry.at + ' [' + entry.stream + '] ' + entry.line);
          setProjectOutput(lines.join('\\n'));
          return;
        }

        if (action === 'attach') {
          const payload = await request(projectPath(state.projectId, '/agents/' + encodeURIComponent(agentId) + '/attach'));
          setProjectOutput(JSON.stringify(payload.attach, null, 2));
        }
      });
    });
  };

  const clearEvents = () => {
    views.eventsLog.textContent = '';
  };

  const appendEvent = (event, payload) => {
    const line = event + ' ' + JSON.stringify(payload);
    views.eventsLog.textContent = (line + '\\n' + views.eventsLog.textContent).slice(0, 24000);
  };

  const stopEventStream = () => {
    if (state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
      appendEvent('system', { message: 'events stopped' });
    }
  };

  const startEventStream = () => {
    if (!state.projectId) {
      throw new Error('Выберите проект перед запуском SSE');
    }

    stopEventStream();
    const base = normalizeBase(views.baseUrl.value);
    const url = base + projectPath(state.projectId, '/events?cursor=' + state.eventCursor);
    const source = new EventSource(url);
    state.eventSource = source;

    source.onmessage = (event) => {
      if (!event.data) {
        return;
      }
      try {
        const payload = JSON.parse(event.data);
        if (payload && payload.seq) {
          state.eventCursor = payload.seq;
        }
        appendEvent(event.type || 'message', payload);
      } catch (_error) {
        appendEvent(event.type || 'message', event.data);
      }
    };

    source.addEventListener('snapshot', (event) => {
      try {
        const payload = JSON.parse(event.data || '{}');
        state.eventCursor = payload.cursor || state.eventCursor;
        appendEvent('snapshot', payload);
      } catch (_error) {
        appendEvent('snapshot', event.data || '');
      }
    });

    source.onerror = () => {
      appendEvent('system', { message: 'events connection error' });
    };

    appendEvent('system', { message: 'events started', url });
  };

  const actionProject = async (suffix, method) => {
    if (!state.projectId) {
      throw new Error('Сначала выберите проект');
    }
    await request(projectPath(state.projectId, suffix), { method: method || 'POST' });
    await loadProject();
    await loadProjects();
  };

  const runProjectRead = async (suffix) => {
    if (!state.projectId) {
      throw new Error('Сначала выберите проект');
    }
    const payload = await request(projectPath(state.projectId, suffix));
    setProjectOutput(payload.output || '');
  };

  const parseEnvLines = (raw) => {
    return String(raw || '')
      .split(/\\r?\\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.includes('='))
      .map((line) => {
        const idx = line.indexOf('=');
        return { key: line.slice(0, idx).trim(), value: line.slice(idx + 1) };
      })
      .filter((entry) => entry.key.length > 0);
  };

  const createProject = async () => {
    const body = {
      repoUrl: views.createRepoUrl.value.trim() || undefined,
      repoRef: views.createRepoRef.value.trim() || undefined,
      sshPort: views.createSshPort.value.trim() || undefined,
      dockerNetworkMode: views.createNetworkMode.value.trim() || undefined,
      up: views.createUp.checked,
      force: views.createForce.checked,
      forceEnv: views.createForceEnv.checked,
      openSsh: false
    };

    await request('/v1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });

    await loadProjects();
  };

  const createAgent = async () => {
    if (!state.projectId) {
      throw new Error('Сначала выберите проект');
    }

    const body = {
      provider: views.agentProvider.value,
      label: views.agentLabel.value.trim() || undefined,
      command: views.agentCommand.value.trim() || undefined,
      cwd: views.agentCwd.value.trim() || undefined,
      env: parseEnvLines(views.agentEnv.value)
    };

    await request(projectPath(state.projectId, '/agents'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });

    await loadAgents();
  };

  const withUiError = (fn) => async () => {
    try {
      await fn();
    } catch (error) {
      appendDebug('UI error', String(error));
      window.alert(String(error));
    }
  };

  const wireActions = () => {
    byId('btn-clear-output').addEventListener('click', () => {
      views.debugOutput.textContent = '';
      views.eventsLog.textContent = '';
      views.projectOutput.textContent = '';
    });

    byId('btn-health').addEventListener('click', withUiError(async () => {
      const payload = await request('/v1/health');
      window.alert('Health: ' + JSON.stringify(payload));
    }));

    byId('btn-projects-refresh').addEventListener('click', withUiError(loadProjects));
    byId('btn-create-project').addEventListener('click', withUiError(createProject));

    byId('btn-up').addEventListener('click', withUiError(() => actionProject('/up', 'POST')));
    byId('btn-down').addEventListener('click', withUiError(() => actionProject('/down', 'POST')));
    byId('btn-recreate').addEventListener('click', withUiError(() => actionProject('/recreate', 'POST')));
    byId('btn-delete').addEventListener('click', withUiError(async () => {
      if (!state.projectId) {
        throw new Error('Сначала выберите проект');
      }
      const ok = window.confirm('Удалить проект ' + state.projectId + '?');
      if (!ok) {
        return;
      }
      await request(projectPath(state.projectId, ''), { method: 'DELETE' });
      stopEventStream();
      state.projectId = '';
      state.project = null;
      state.agents = [];
      renderProjectDetails();
      renderAgents();
      await loadProjects();
    }));

    byId('btn-ps').addEventListener('click', withUiError(() => runProjectRead('/ps')));
    byId('btn-logs').addEventListener('click', withUiError(() => runProjectRead('/logs')));

    byId('btn-events-start').addEventListener('click', withUiError(async () => {
      clearEvents();
      startEventStream();
    }));
    byId('btn-events-stop').addEventListener('click', () => stopEventStream());

    byId('btn-agent-start').addEventListener('click', withUiError(createAgent));
    byId('btn-agents-refresh').addEventListener('click', withUiError(loadAgents));
  };

  const bootstrap = async () => {
    views.baseUrl.value = window.location.origin;
    wireActions();
    renderProjectDetails();
    renderAgents();
    await loadProjects();
  };

  window.addEventListener('beforeunload', () => stopEventStream());

  bootstrap().catch((error) => {
    appendDebug('bootstrap failure', String(error));
  });
})();
`
