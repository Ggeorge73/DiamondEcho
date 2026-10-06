import React, { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';

const TITLE = 'Page not found | DiamondEcho';

const NotFound = () => {
  const { pathname } = useLocation();
  const headingRef = useRef(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = TITLE;
    // Cloudflare Pages answers an unknown address with 404.html and a 404 status
    // (public/_redirects, scripts/make-404.mjs). This hint stays for any host
    // that serves the app shell with a 200 instead, such as the local dev server.
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex';
    document.head.appendChild(robots);
    headingRef.current?.focus();
    return () => {
      document.title = previousTitle;
      robots.remove();
    };
  }, []);

  const shownPath = pathname.length > 80 ? `${pathname.slice(0, 80)}…` : pathname;

  return (
    <main className="mf-page">
      <section className="mf-page-hero" aria-labelledby="not-found-title">
        <div className="mf-page-hero__inner"><div>
          <p className="eyebrow">Page not found</p>
          <h1 id="not-found-title" ref={headingRef} tabIndex={-1}>We can’t find <em>that page.</em></h1>
          <p className="mf-page-hero__lede">
            Nothing exists at <span className="mf-notfound__path">{shownPath}</span>. The
            address may be mistyped, or the page may have been moved or removed.
          </p>
          <div className="mf-notfound__actions">
            <Link className="mf-btn mf-btn--solid" to="/">Go to the home page</Link>
            <Link className="mf-btn" to="/search">Search Georgia MLS</Link>
          </div>
        </div></div>
      </section>
    </main>
  );
};

export default NotFound;
