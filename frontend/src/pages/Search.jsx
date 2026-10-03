import React from 'react';
import { useSearchParams } from 'react-router-dom';
import GamlsSearch from '../components/GamlsSearch';

export { GAMLS_SEARCH_URL, GAMLS_SALE_SEARCH_URL, GAMLS_RENTAL_SEARCH_URL } from '../components/GamlsSearch';

const Search = () => {
  const [params] = useSearchParams();
  const requestedSearch = (params.get('q') || '').trim();
  const rentalIntent = params.get('status') === 'rent';
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
      <GamlsSearch requestedSearch={requestedSearch} rentalIntent={rentalIntent} />
    </main>
  );
};
export default Search;
