import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: path.join(__dirname, "..", "..")
  },
  allowedDevOrigins: [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://192.168.0.164:3000",
    "http://192.168.0.164:3001"
  ]
}

export default nextConfig
