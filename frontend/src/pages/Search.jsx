import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import './Search.css';

export const GAMLS_SEARCH_URL = 'https://georgeolugbe.georgiamls.com/idxsearch/';

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
      <section className="de-idx" aria-label="Georgia MLS property search">
        {(requestedSearch || rentalIntent) && (
          <p className="de-idx__notice" role="note">
            {requestedSearch && <>You arrived looking for “{requestedSearch}”. </>}
            {rentalIntent && <>Looking for a rental? </>}
            This search has not been filtered automatically. Select your location
            and any available rental options within Georgia MLS.
          </p>
        )}
        <div className="de-idx__toolbar">
          <p id="idx-help">
            Search provided by Georgia MLS. If the search is blank or difficult to
            use on your device, open it directly.
          </p>
          <a className="mf-btn mf-btn--solid" href={GAMLS_SEARCH_URL}
            target="_blank" rel="noopener noreferrer">
            Open Georgia MLS search (new tab)
          </a>
        </div>
        <iframe className="de-idx__frame" src={GAMLS_SEARCH_URL}
          title="Georgia MLS property search" aria-describedby="idx-help" />
        <div className="de-idx__next">
          <p>
            Need help with a property? Include its address or MLS number in your
            inquiry. Selections made in Georgia MLS are not automatically sent to
            DiamondEcho inquiries or Deal Studio.
          </p>
          <Link className="mf-btn" to="/inquire?type=buyer">Ask about a property</Link>
          <Link className="mf-btn" to="/investment-calculator">Open Deal Studio</Link>
        </div>
      </section>
    </main>
  );
};
export default Search;
