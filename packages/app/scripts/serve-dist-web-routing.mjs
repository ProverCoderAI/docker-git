const dbGateOwnedPathPrefixes = [
  "/admin",
  "/admin-license",
  "/build/",
  "/bulma.css",
  "/connections",
  "/database-connections",
  "/dimensions.css",
  "/favicon.ico",
  "/forgot-password",
  "/global.css",
  "/icon-colors.css",
  "/license",
  "/login",
  "/manifest.json",
  "/oauth",
  "/plugins",
  "/redirect",
  "/reset-password",
  "/runners",
  "/scheduler",
  "/set-admin-password",
  "/storage",
  "/tokens.css"
]

const isDbGateOwnedPath = (pathname) =>
  dbGateOwnedPathPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix))

const isFederationPath = (pathname) =>
  pathname === "/federation" || pathname.startsWith("/federation/")

// CHANGE: expose the standards-defined WebFinger endpoint at the public root.
// WHY: ActivityPub discovery queries /.well-known/webfinger on the actor domain, not under /api.
// QUOTE(ТЗ): "В руте .well-known должен быть"
// REF: issue-334-webfinger-root-route
// SOURCE: https://www.rfc-editor.org/rfc/rfc7033
// FORMAT THEOREM: forall p: p = "/.well-known/webfinger" -> proxyTarget(p) = API(p)
// PURITY: CORE
// INVARIANT: only the WebFinger well-known path is claimed by the browser shell.
// COMPLEXITY: O(1)/O(1)
const isWellKnownWebFingerPath = (pathname) =>
  pathname === "/.well-known/webfinger"

export const shouldProxyHttpPath = (pathname) =>
  pathname === "/api" ||
  pathname.startsWith("/api/") ||
  isFederationPath(pathname) ||
  isWellKnownWebFingerPath(pathname) ||
  pathname.startsWith("/p/") ||
  pathname.startsWith("/b/") ||
  pathname.startsWith("/d/") ||
  isDbGateOwnedPath(pathname)
