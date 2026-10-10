import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { clearRetiredTracking } from "./lib/retiredTracking";
import { prerenderMatches } from "./lib/prerendered";

clearRetiredTracking();

const container = document.getElementById("root");
const app = (
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// The build saves each public page as HTML, so its words are on screen before
// this script has loaded. When that HTML is the page the address asks for, the
// app takes it over as it stands: nothing is redrawn, and the Georgia MLS
// search that is already loading in it is kept. In every other case (an
// address with its own "?" part, the development server, an unknown address)
// the page is drawn from nothing, as it always was.
if (prerenderMatches(container, window.location)) {
  // The saved HTML holds its fields and buttons inert until now, so nothing
  // could be typed into a form the app was not yet listening to.
  container.querySelectorAll("[inert]").forEach((node) => node.removeAttribute("inert"));
  ReactDOM.hydrateRoot(container, app, {
    // The saved HTML and the app disagreed somewhere, and the app redrew that
    // part itself. Nothing is lost, but it should not happen: say so where a
    // developer will see it.
    onRecoverableError: (error) => console.warn("DiamondEcho: a saved page was redrawn.", error),
  });
} else {
  container.textContent = "";
  ReactDOM.createRoot(container).render(app);
}
