import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { applyPageMeta, pageForPath } from '../lib/pageMeta';

// Keeps the browser tab's title, and what the page tells search engines about
// itself, in step with the page on screen as the visitor moves around. The
// first page a visitor opens already carries all of this in its saved HTML
// (scripts/prerender.mjs); this is for every page after it.
const PageMeta = () => {
  const { pathname } = useLocation();
  const page = pageForPath(pathname);
  useEffect(() => { applyPageMeta(document, page); }, [page]);
  return null;
};

export default PageMeta;
