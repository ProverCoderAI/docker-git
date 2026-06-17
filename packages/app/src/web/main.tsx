import { createRoot } from "react-dom/client"

import { App } from "./app.js"
import { configureTerminalApiBaseUrlResolver } from "./terminal.js"

configureTerminalApiBaseUrlResolver()

const rootElement = document.querySelector("#root")

if (rootElement !== null) {
  createRoot(rootElement).render(<App />)
}
