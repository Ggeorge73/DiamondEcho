// Used by the build only (scripts/prerender.mjs), never by the browser: draws
// one page of the app as HTML text. It is the same App the browser runs, with
// the router fixed at the page's address, so the saved HTML is the page a
// visitor would see and the app can take it over without redrawing it.
import React from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import App from './App';
import { prerenderMatches } from './lib/prerendered';

export { PAGES, STRUCTURED_DATA_ID, headFor, jsonForScript } from './lib/pageMeta';
export { BROKERAGE } from './lib/contact';

// The same wrapping as src/index.js.
export const renderPage = (path) => renderToString(
  <React.StrictMode>
    <App Router={StaticRouter} location={path} />
  </React.StrictMode>,
);

// The test in lib/prerendered.js, as text, for the build to write into each page.
export const prerenderGuard = prerenderMatches.toString();
