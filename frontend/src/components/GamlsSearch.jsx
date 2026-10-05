import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { searchPath } from '../lib/searchCriteria';
import '../pages/Search.css';

export const GAMLS_SEARCH_URL = 'https://georgeolugbe.georgiamls.com/idxsearch/';

// styp, gtyp and typ are the parameters Georgia MLS uses in its own search-page
// links. typ pre-selects boxes in the provider's Type list; it does not hide
// the other boxes. See docs/gamls-search-integration.md for what was verified.
export const GAMLS_SALE_SEARCH_URL = `${GAMLS_SEARCH_URL}?styp=sale&gtyp=loc&typ=sd,sa,ll,mf,cm`;
// The provider's "For Rent" form (styp=rent) drops the type and returns sale
// listings, so rentals use the "For Sale" form with Rental (Residential) ticked.
export const GAMLS_RENTAL_SEARCH_URL = `${GAMLS_SEARCH_URL}?styp=sale&gtyp=loc&typ=rr`;

// showCriteriaLinks is for the /search page, where the note about an older
// link and the for-sale/rentals choice live in the address. The home page
// embeds the same search without them.
const GamlsSearch = ({ requestedSearch = '', rentalIntent = false, loading = 'eager', showCriteriaLinks = false }) => {
  const [restarts, setRestarts] = useState(0);
  const src = rentalIntent ? GAMLS_RENTAL_SEARCH_URL : GAMLS_SALE_SEARCH_URL;
  return (
      <section className="de-idx" aria-label="Georgia MLS property search">
        {(requestedSearch || rentalIntent) && (
          <div className="de-idx__notice" role="note">
            <p>
              {requestedSearch && (
                <>You arrived looking for “{requestedSearch}”. That location has not
                been filled in automatically; enter it in the search below. </>
              )}
              {rentalIntent && (
                <>Looking for a rental? Rental (Residential) is pre-selected under
                Type. Georgia MLS titles this form “For Sale”, but with that box
                ticked the results are rentals. Georgia MLS shows the rent amount
                without stating the period, so confirm with the listing whether
                it is monthly.</>
              )}
            </p>
            {showCriteriaLinks && (
              <p className="de-idx__notice-actions">
                {requestedSearch && <Link to={searchPath({ rentalIntent })}>Hide this note</Link>}
                {rentalIntent && <Link to={searchPath({ requestedSearch })}>Show homes for sale instead</Link>}
              </p>
            )}
          </div>
        )}
        <div className="de-idx__toolbar">
          <p id="idx-help">
            Search properties below, powered by Georgia MLS.{' '}
            {rentalIntent
              ? 'Change the Type boxes to include other property types.'
              : 'For-sale property types are pre-selected; change the Type boxes to include rentals.'}
            {' '}What you choose in the search stays inside Georgia MLS. This
            page’s link does not carry it, so anyone you send the link to
            starts a new search.
          </p>
          <button type="button" className="mf-btn" onClick={() => setRestarts((count) => count + 1)}>
            Start a new search
          </button>
          <span className="de-idx__status" role="status">
            {restarts > 0 ? 'The search form has been reloaded.' : ''}
          </span>
        </div>
        {/* The key replaces the frame instead of re-pointing it. Re-pointing a
            frame adds a step to the browser's history, which left Back showing
            the for-sale form under the rentals note (DE-21). */}
        <iframe key={`${src}#${restarts}`} loading={loading} className="de-idx__frame"
          src={src}
          title="Georgia MLS property search" aria-describedby="idx-help" />
        <p className="de-idx__fallback">
          If the search above is blank or stops responding, choose “Start a new
          search”. If it stays blank, Georgia MLS may be unavailable; the phone
          numbers at the foot of this page reach us directly.
        </p>
        <div className="de-idx__next">
          <p>
            Need help with a property? Include its address or MLS number in your
            inquiry. Selections made in Georgia MLS are not automatically sent to
            DiamondEcho inquiries or Deal Studio.
          </p>
          <Link className="mf-btn" to="/inquire?type=buyer">Ask about a property</Link>
          <Link className="mf-btn" to="/inquire?type=tour">Request a tour</Link>
          <Link className="mf-btn" to="/investment-calculator">Open Deal Studio</Link>
        </div>
      </section>
  );
};
export default GamlsSearch;
