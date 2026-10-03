import React, { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';

const TITLE = 'Page not found | DiamondEcho';

const NotFound = () => {
  const { pathname } = useLocation();
  const headingRef = useRef(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = TITLE;
    // The host serves the app shell for every address, so search engines get this
    // hint from the page itself rather than from a 404 status.
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
