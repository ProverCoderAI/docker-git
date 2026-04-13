import { createRoot } from "react-dom/client"

import { App } from "./app.js"

const rootElement = document.querySelector("#root")

if (rootElement !== null) {
  createRoot(rootElement).render(<App />)
}
