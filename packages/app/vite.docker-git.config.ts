import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig({
  publicDir: false,
  resolve: {
    alias: [
      {
        find: /^@lib\/(.*)$/u,
        replacement: path.resolve(__dirname, "src/lib") + "/$1.ts"
      },
      {
        find: "@lib",
        replacement: path.resolve(__dirname, "src/lib/index.ts")
      },
      {
        find: /^@\/(.*)$/u,
        replacement: path.resolve(__dirname, "src") + "/$1"
      },
      {
        find: "@",
        replacement: path.resolve(__dirname, "src")
      },
      {
        find: "@effect-template/lib",
        replacement: path.resolve(__dirname, "../lib/src")
      }
    ]
  },
  build: {
    target: "node20",
    outDir: "dist",
    sourcemap: true,
    ssr: "src/docker-git/main.ts",
    rollupOptions: {
      external: ["@gridland/bun"],
      output: {
        format: "es",
        entryFileNames: "src/docker-git/main.js"
      }
    },
    ssrEmitAssets: false
  },
  ssr: {
    target: "node"
  }
})
