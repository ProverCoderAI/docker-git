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
        find: /^@\/(.*)$/u,
        replacement: path.resolve(__dirname, "src") + "/$1"
      },
      {
        find: "@",
        replacement: path.resolve(__dirname, "src")
      }
    ]
  },
  build: {
    target: "node20",
    outDir: "dist",
    sourcemap: true,
    ssr: "src/app/main.ts",
    rollupOptions: {
      output: {
        format: "es",
        entryFileNames: "main.js"
      }
    }
  },
  ssr: {
    target: "node"
  }
})
