import * as fs from "node:fs"

// CHANGE: detect Docker-in-Docker environment
// WHY: SSH host resolution and path mapping differ in DinD vs host environments
// PURITY: CORE
// INVARIANT: returns true when /.dockerenv exists (standard Docker indicator)
export const isInsideDocker = (): boolean => {
  try {
    return fs.existsSync("/.dockerenv")
  } catch {
    return false
  }
}
