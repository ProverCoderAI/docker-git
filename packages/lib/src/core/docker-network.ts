import { deriveRepoPathParts } from "./domain.js"

export type DockerNetworkConfig = {
  readonly subnet: string
  readonly ipAddress: string
}

const hashRepoSeed = (value: string): number => {
  let hash = 0x81_1C_9D_C5
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01_00_01_93)
  }
  return hash >>> 0
}

// CHANGE: derive a stable docker DNS hostname from repo URL
// WHY: allow consistent per-project DNS aliases
// QUOTE(ТЗ): "docker.{dns}:port"
// REF: user-request-2026-01-30-dns
// SOURCE: n/a
// FORMAT THEOREM: forall url: dns(url) is deterministic
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: hostname always begins with docker.
// COMPLEXITY: O(n) where n = |url|
export const deriveDockerDnsName = (repoUrl: string): string => {
  const parts = deriveRepoPathParts(repoUrl).pathParts
  return ["docker", ...parts].join(".")
}

// CHANGE: derive a stable docker subnet + IP for per-project isolation
// WHY: avoid port conflicts by giving each container a unique IP
// QUOTE(ТЗ): "У каждого контейнера свой IP т.е свой домен"
// REF: user-request-2026-01-30-dns
// SOURCE: n/a
// FORMAT THEOREM: forall url: net(url) is deterministic
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: subnet in 172.20.0.0/16..172.31.0.0/16, IP host in [10,209]
// COMPLEXITY: O(n) where n = |url|
export const deriveDockerNetworkConfig = (repoUrl: string): DockerNetworkConfig => {
  const hash = hashRepoSeed(repoUrl)
  const subnetA = 20 + (hash % 12)
  const subnetB = (hash >>> 8) & 0xFF
  const hostOctet = 10 + ((hash >>> 16) % 200)
  const subnet = `172.${subnetA}.${subnetB}.0/24`
  const ipAddress = `172.${subnetA}.${subnetB}.${hostOctet}`
  return { subnet, ipAddress }
}
