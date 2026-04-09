/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DOCKER_GIT_API_BASE_URL?: string
  readonly VITE_DOCKER_GIT_TERMINAL_API_BASE_URL?: string
  readonly VITE_DOCKER_GIT_TERMINAL_API_PORT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
