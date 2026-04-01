export const parseInspectNetworkEntry = (line: string): ReadonlyArray<readonly [string, string]> => {
  const idx = line.indexOf("=")
  if (idx <= 0) {
    return []
  }
  const network = line.slice(0, idx).trim()
  const ip = line.slice(idx + 1).trim()
  if (network.length === 0 || ip.length === 0) {
    return []
  }
  const entry: readonly [string, string] = [network, ip]
  return [entry]
}
