import { defineConfig } from "vite"

export default defineConfig({
  publicDir: false,
  build: {
    target: "node20",
    outDir: "dist",
    sourcemap: true,
    ssr: "src/main.ts",
    rollupOptions: {
      output: {
        banner: "#!/usr/bin/env bun",
        entryFileNames: "docker-git-session-sync.js",
        format: "es"
      }
    },
    ssrEmitAssets: false
  },
  ssr: {
    target: "node"
  }
})
