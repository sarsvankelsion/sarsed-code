/* @refresh reload */
import "@fontsource/newsreader/400.css"
import "@fontsource/newsreader/400-italic.css"
import "@fontsource/newsreader/500.css"
import "@fontsource/newsreader/600.css"
import "@kilocode/kilo-ui/styles"
import { render } from "solid-js/web"
import App from "./App"

const root = document.getElementById("root")

if (!root) {
  throw new Error("Root element not found")
}

render(() => <App />, root)
