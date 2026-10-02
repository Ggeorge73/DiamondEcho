import React from 'react';
import { Link } from 'react-router-dom';
import '../pages/Search.css';

export const GAMLS_SEARCH_URL = 'https://georgeolugbe.georgiamls.com/idxsearch/';

const GamlsSearch = ({ requestedSearch = '', rentalIntent = false, loading = 'eager' }) => (
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
            Search properties below, powered by Georgia MLS.
          </p>
        </div>
        <iframe loading={loading} className="de-idx__frame" src={GAMLS_SEARCH_URL}
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
);
export default GamlsSearch;
