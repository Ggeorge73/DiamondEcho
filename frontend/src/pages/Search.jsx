import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import GamlsSearch from '../components/GamlsSearch';
import { canonicalSearchParams, readSearchCriteria } from '../lib/searchCriteria';

export { GAMLS_SEARCH_URL, GAMLS_SALE_SEARCH_URL, GAMLS_RENTAL_SEARCH_URL } from '../components/GamlsSearch';

const Search = () => {
  const [params, setParams] = useSearchParams();
  const { requestedSearch, rentalIntent } = readSearchCriteria(params);

  // Put q and status into their normal form in the address bar, so the link a
  // visitor copies says what the page is actually doing. It replaces the
  // current history entry, so Back still leaves the page in one step.
  const current = params.toString();
  const canonical = canonicalSearchParams(params).toString();
  useEffect(() => {
    if (canonical !== current) setParams(new URLSearchParams(canonical), { replace: true });
  }, [canonical, current, setParams]);

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
