import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigationType, useSearchParams } from 'react-router-dom';
import GamlsSearch from '../components/GamlsSearch';
import { canonicalSearchParams, readSearchCriteria } from '../lib/searchCriteria';

export { GAMLS_SEARCH_URL, GAMLS_SALE_SEARCH_URL, GAMLS_RENTAL_SEARCH_URL } from '../components/GamlsSearch';

// `query` is the part of the address after "?" that this page should read. It
// is given by KeptSearch, which keeps the page loaded while the visitor is on
// another page; then the live address belongs to that other page, and this one
// must neither read it nor rewrite it. Used on its own, the page reads the
// live address.
const Search = ({ active = true, query }) => {
  const [liveParams, setParams] = useSearchParams();
  const params = useMemo(
    () => (query === undefined ? liveParams : new URLSearchParams(query)),
    [query, liveParams],
  );
  const { requestedSearch, rentalIntent } = readSearchCriteria(params);

  // Put q and status into their normal form in the address bar, so the link a
  // visitor copies says what the page is actually doing. It replaces the
  // current history entry, so Back still leaves the page in one step.
  const current = params.toString();
  const canonical = canonicalSearchParams(params).toString();
  useEffect(() => {
    if (active && canonical !== current) setParams(new URLSearchParams(canonical), { replace: true });
  }, [active, canonical, current, setParams]);

  return (
    <main className="mf-page">
      <section className="mf-page-hero">
        <div className="mf-page-hero__inner"><div>
          <p className="eyebrow">DiamondEcho — Georgia MLS</p>
          <h1>Find your next <em>home.</em></h1>
          <p className="mf-page-hero__lede">
            Explore properties through Georgia MLS. Choose your location, price,
            and property preferences in the search below.
          </p>
        </div></div>
      </section>
      <GamlsSearch requestedSearch={requestedSearch} rentalIntent={rentalIntent} showCriteriaLinks />
    </main>
  );
};
export default Search;

// The search page, kept loaded once the visitor has opened it.
//
// Leaving /search used to remove the page and its Georgia MLS frame. A visitor
// who opened a listing, chose "Ask about a property" and pressed Back found the
// empty form instead of the listing, and the steps they had taken in the removed
// frame were still in the browser's history, so further Back presses did nothing
// (DE-21). Now the page is hidden while the visitor is elsewhere and shown again,
// as they left it, when they return.
export const KeptSearch = () => {
  const { pathname, search } = useLocation();
  const onSearch = pathname === '/search';
  const [kept, setKept] = useState(onSearch ? search : null);
  if (onSearch && kept !== search) setKept(search);

  // Back or Forward to the search also returns to the place on the page the
  // visitor had scrolled to, so the listing they left is in view again. Opening
  // the search from a link starts at the top, as every page does.
  const navigationType = useNavigationType();
  const scrolledTo = useRef(0);
  useEffect(() => {
    if (!onSearch) return undefined;
    if (navigationType === 'POP' && scrolledTo.current > 0) {
      window.scrollTo({ top: scrolledTo.current, behavior: 'instant' });
    }
    const remember = () => { scrolledTo.current = window.scrollY; };
    window.addEventListener('scroll', remember, { passive: true });
    return () => window.removeEventListener('scroll', remember);
  }, [onSearch, navigationType]);

  if (!onSearch && kept === null) return null;
  return (
    <div className="de-kept" hidden={!onSearch}>
      <Search active={onSearch} query={onSearch ? search : kept} />
    </div>
  );
};
