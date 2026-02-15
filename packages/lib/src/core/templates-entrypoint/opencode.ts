import type { TemplateConfig } from "../domain.js"

const entrypointOpenCodeTemplate = `OPENCODE_DATA_DIR="/home/__SSH_USER__/.local/share/opencode"
OPENCODE_AUTH_FILE="$OPENCODE_DATA_DIR/auth.json"
OPENCODE_SHARED_HOME="__CODEX_HOME__-shared/opencode"
OPENCODE_SHARED_AUTH_FILE="$OPENCODE_SHARED_HOME/auth.json"

# OpenCode: share auth.json across projects (so /connect is one-time)
OPENCODE_SHARE_AUTH="\${OPENCODE_SHARE_AUTH:-1}"
if [[ "$OPENCODE_SHARE_AUTH" == "1" ]]; then
  # Store in the shared auth volume to persist across projects/containers.
  mkdir -p "$OPENCODE_DATA_DIR" "$OPENCODE_SHARED_HOME"
  chown -R 1000:1000 "$OPENCODE_DATA_DIR" "$OPENCODE_SHARED_HOME" || true

  # Guard against a bad bind mount creating a directory at auth.json.
  if [[ -d "$OPENCODE_AUTH_FILE" ]]; then
    mv "$OPENCODE_AUTH_FILE" "$OPENCODE_AUTH_FILE.bak-$(date +%s)" || true
  fi

  # Migrate existing per-project auth into the shared location once.
  if [[ -f "$OPENCODE_AUTH_FILE" && ! -L "$OPENCODE_AUTH_FILE" ]]; then
    if [[ -f "$OPENCODE_SHARED_AUTH_FILE" ]]; then
      LOCAL_AUTH="$OPENCODE_AUTH_FILE" SHARED_AUTH="$OPENCODE_SHARED_AUTH_FILE" node - <<'NODE'
const fs = require("fs")
const localPath = process.env.LOCAL_AUTH
const sharedPath = process.env.SHARED_AUTH
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"))
  } catch {
    return {}
  }
}
const local = readJson(localPath)
const shared = readJson(sharedPath)
const merged = { ...local, ...shared } // shared wins on conflicts
fs.writeFileSync(sharedPath, JSON.stringify(merged, null, 2), { mode: 0o600 })
NODE
    else
      cp "$OPENCODE_AUTH_FILE" "$OPENCODE_SHARED_AUTH_FILE" || true
      chmod 600 "$OPENCODE_SHARED_AUTH_FILE" || true
    fi
    chown 1000:1000 "$OPENCODE_SHARED_AUTH_FILE" || true
    rm -f "$OPENCODE_AUTH_FILE" || true
  fi

  ln -sf "$OPENCODE_SHARED_AUTH_FILE" "$OPENCODE_AUTH_FILE"
fi

# OpenCode: auto-seed auth from Codex (so /connect is automatic)
OPENCODE_AUTO_CONNECT="\${OPENCODE_AUTO_CONNECT:-1}"
if [[ "$OPENCODE_AUTO_CONNECT" == "1" ]]; then
  CODEX_AUTH_FILE="__CODEX_HOME__/auth.json"
  OPENCODE_SEED_AUTH="$OPENCODE_AUTH_FILE"
  if [[ "$OPENCODE_SHARE_AUTH" == "1" ]]; then
    OPENCODE_SEED_AUTH="$OPENCODE_SHARED_AUTH_FILE"
  fi
  CODEX_AUTH="$CODEX_AUTH_FILE" OPENCODE_AUTH="$OPENCODE_SEED_AUTH" node - <<'NODE'
const fs = require("fs")
const path = require("path")

const codexPath = process.env.CODEX_AUTH
const opencodePath = process.env.OPENCODE_AUTH

if (!codexPath || !opencodePath) {
  process.exit(0)
}

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"))
  } catch {
    return undefined
  }
}

const writeJsonAtomic = (p, value) => {
  const dir = path.dirname(p)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, ".tmp-" + path.basename(p) + "-" + process.pid + "-" + Date.now())
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, p)
}

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)

const decodeJwtClaims = (jwt) => {
  if (typeof jwt !== "string") return undefined
  const parts = jwt.split(".")
  if (parts.length !== 3) return undefined
  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf8")
    return JSON.parse(payload)
  } catch {
    return undefined
  }
}

const extractAccountIdFromClaims = (claims) => {
  if (!isRecord(claims)) return undefined
  if (typeof claims.chatgpt_account_id === "string") return claims.chatgpt_account_id
  const openaiAuth = claims["https://api.openai.com/auth"]
  if (isRecord(openaiAuth) && typeof openaiAuth.chatgpt_account_id === "string") {
    return openaiAuth.chatgpt_account_id
  }
  const orgs = claims.organizations
  if (Array.isArray(orgs) && orgs.length > 0) {
    const first = orgs[0]
    if (isRecord(first) && typeof first.id === "string") return first.id
  }
  return undefined
}

const extractJwtExpiryMs = (claims) => {
  if (!isRecord(claims)) return undefined
  if (typeof claims.exp !== "number") return undefined
  return claims.exp * 1000
}

const codex = readJson(codexPath)
if (!isRecord(codex)) process.exit(0)

let opencode = readJson(opencodePath)
if (!isRecord(opencode)) opencode = {}

if (opencode.openai) {
  process.exit(0)
}

const apiKey = codex.OPENAI_API_KEY
if (typeof apiKey === "string" && apiKey.trim().length > 0) {
  opencode.openai = { type: "api", key: apiKey.trim() }
  writeJsonAtomic(opencodePath, opencode)
  process.exit(0)
}

const tokens = codex.tokens
if (!isRecord(tokens)) process.exit(0)

const access = tokens.access_token
const refresh = tokens.refresh_token
if (typeof access !== "string" || access.length === 0) process.exit(0)
if (typeof refresh !== "string" || refresh.length === 0) process.exit(0)

const accessClaims = decodeJwtClaims(access)
const expires = extractJwtExpiryMs(accessClaims)
if (typeof expires !== "number") process.exit(0)

let accountId = undefined
if (typeof tokens.account_id === "string" && tokens.account_id.length > 0) {
  accountId = tokens.account_id
} else {
  const idClaims = decodeJwtClaims(tokens.id_token)
  accountId =
    extractAccountIdFromClaims(idClaims) ||
    extractAccountIdFromClaims(accessClaims)
}

const entry = {
  type: "oauth",
  refresh,
  access,
  expires,
  ...(typeof accountId === "string" && accountId.length > 0 ? { accountId } : {})
}

opencode.openai = entry
writeJsonAtomic(opencodePath, opencode)
NODE
  chown 1000:1000 "$OPENCODE_SEED_AUTH" 2>/dev/null || true
fi

# OpenCode: ensure global config exists (plugins + permissions)
OPENCODE_CONFIG_DIR="/home/__SSH_USER__/.config/opencode"
OPENCODE_CONFIG_JSON="$OPENCODE_CONFIG_DIR/opencode.json"
OPENCODE_CONFIG_JSONC="$OPENCODE_CONFIG_DIR/opencode.jsonc"

mkdir -p "$OPENCODE_CONFIG_DIR"
chown -R 1000:1000 "$OPENCODE_CONFIG_DIR" || true

if [[ ! -f "$OPENCODE_CONFIG_JSON" && ! -f "$OPENCODE_CONFIG_JSONC" ]]; then
  cat <<'EOF' > "$OPENCODE_CONFIG_JSON"
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["oh-my-opencode"],
  "permission": {
    "doom_loop": "allow",
    "external_directory": "allow",
    "read": {
      "*": "allow",
      "*.env": "allow",
      "*.env.*": "allow",
      "*.env.example": "allow"
    }
  }
}
EOF
  chown 1000:1000 "$OPENCODE_CONFIG_JSON" || true
fi`

// CHANGE: bootstrap OpenCode config (permissions + plugins) and share OpenCode auth.json across projects
// WHY: make OpenCode usable out-of-the-box inside disposable docker-git containers
// QUOTE(ТЗ): "Preinstall OpenCode and oh-my-opencode with full authorization of existing tools"
// REF: issue-34
// SOURCE: n/a
// FORMAT THEOREM: forall s: start(s) -> config_exists(s)
// PURITY: CORE
// INVARIANT: never overwrites an existing opencode.json/opencode.jsonc
// COMPLEXITY: O(1)
export const renderEntrypointOpenCodeConfig = (config: TemplateConfig): string =>
  entrypointOpenCodeTemplate
    .replaceAll("__SSH_USER__", config.sshUser)
    .replaceAll("__CODEX_HOME__", config.codexHome)
