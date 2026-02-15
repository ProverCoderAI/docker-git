import type { TemplateConfig } from "../domain.js"

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
  `# OpenCode: share auth.json across projects (so /connect is one-time)
OPENCODE_SHARE_AUTH="\${OPENCODE_SHARE_AUTH:-1}"
if [[ "$OPENCODE_SHARE_AUTH" == "1" ]]; then
  OPENCODE_DATA_DIR="/home/${config.sshUser}/.local/share/opencode"
  OPENCODE_AUTH_FILE="$OPENCODE_DATA_DIR/auth.json"

  # Store in the shared auth volume to persist across projects/containers.
  OPENCODE_SHARED_HOME="${config.codexHome}-shared/opencode"
  OPENCODE_SHARED_AUTH_FILE="$OPENCODE_SHARED_HOME/auth.json"

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

# OpenCode: ensure global config exists (plugins + permissions)
OPENCODE_CONFIG_DIR="/home/${config.sshUser}/.config/opencode"
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
