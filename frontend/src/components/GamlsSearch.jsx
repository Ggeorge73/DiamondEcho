import React from 'react';
import { Link } from 'react-router-dom';
import '../pages/Search.css';

export const GAMLS_SEARCH_URL = 'https://georgeolugbe.georgiamls.com/idxsearch/';

// styp, gtyp and typ are the parameters Georgia MLS uses in its own search-page
// links. typ pre-selects boxes in the provider's Type list; it does not hide
// the other boxes. See docs/gamls-search-integration.md for what was verified.
export const GAMLS_SALE_SEARCH_URL = `${GAMLS_SEARCH_URL}?styp=sale&gtyp=loc&typ=sd,sa,ll,mf,cm`;
// The provider's "For Rent" form (styp=rent) drops the type and returns sale
// listings, so rentals use the "For Sale" form with Rental (Residential) ticked.
export const GAMLS_RENTAL_SEARCH_URL = `${GAMLS_SEARCH_URL}?styp=sale&gtyp=loc&typ=rr`;

const GamlsSearch = ({ requestedSearch = '', rentalIntent = false, loading = 'eager' }) => (
      <section className="de-idx" aria-label="Georgia MLS property search">
        {(requestedSearch || rentalIntent) && (
          <p className="de-idx__notice" role="note">
            {requestedSearch && (
              <>You arrived looking for “{requestedSearch}”. That location has not
              been filled in automatically; enter it in the search below. </>
            )}
            {rentalIntent && (
              <>Looking for a rental? Rental (Residential) is pre-selected under
              Type. Georgia MLS titles this form “For Sale”, but with that box
              ticked the results are rentals.</>
            )}
          </p>
        )}
        <div className="de-idx__toolbar">
          <p id="idx-help">
            Search properties below, powered by Georgia MLS.{' '}
            {rentalIntent
              ? 'Change the Type boxes to include other property types.'
              : 'For-sale property types are pre-selected; change the Type boxes to include rentals.'}
          </p>
        </div>
        <iframe loading={loading} className="de-idx__frame"
          src={rentalIntent ? GAMLS_RENTAL_SEARCH_URL : GAMLS_SALE_SEARCH_URL}
          title="Georgia MLS property search" aria-describedby="idx-help" />
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
export default GamlsSearch;
