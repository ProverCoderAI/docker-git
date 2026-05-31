import {
  setTerminalApiBaseUrlResolver,
  trimTerminalTrailingSlash
} from "@prover-coder-ai/docker-git-terminal/web/terminal"

import { resolveApiBaseUrl } from "./api-http.js"

const resolveConfiguredTerminalApiBaseUrl = (): string | null => {
  const configured = import.meta.env["VITE_DOCKER_GIT_TERMINAL_API_BASE_URL"]
  if (configured !== undefined && configured.trim().length > 0) {
    return trimTerminalTrailingSlash(configured.trim())
  }
  return null
}

setTerminalApiBaseUrlResolver(() => resolveConfiguredTerminalApiBaseUrl() ?? resolveApiBaseUrl())

export * from "@prover-coder-ai/docker-git-terminal/web/terminal"
