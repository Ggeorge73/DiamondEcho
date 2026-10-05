import React, { useEffect, useId, useRef, useState } from 'react';
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

export const RELOADED_NOTE_MS = 8000;

const FRAMES = [
  { kind: 'sale', src: GAMLS_SALE_SEARCH_URL },
  { kind: 'rent', src: GAMLS_RENTAL_SEARCH_URL },
];

// showCriteriaLinks is for the /search page, where the note about an older
// link and the for-sale/rentals choice live in the address. The home page
// embeds the same search without them.
const GamlsSearch = ({ requestedSearch = '', rentalIntent = false, loading = 'eager', showCriteriaLinks = false }) => {
  const active = rentalIntent ? 'rent' : 'sale';
  // The for-sale search and the rentals search each keep their own frame. Only
  // the one the address asks for is shown; the other stays loaded and hidden.
  //
  // Why not one frame: pointing it at the other search adds a step to the
  // browser's history, which left Back showing for-sale results under the
  // rentals note. Replacing it removes a frame whose steps are still in the
  // history, which left Back presses that did nothing and threw away the
  // results the visitor had left (DE-21). With a frame each, nothing is added
  // to or removed from the history when the visitor moves between the two.
  const [view, setView] = useState({ active, opened: [active], reloaded: false });
  if (view.active !== active) {
    setView({
      active,
      opened: view.opened.includes(active) ? view.opened : [...view.opened, active],
      reloaded: false,
    });
  }
  const opened = view.opened.includes(active) ? view.opened : [...view.opened, active];
  // Two searches can be in the page at once (the home page's, and the kept
  // search page), so the help text cannot use one fixed id.
  const helpId = useId();
  const frames = useRef({});
  const startNewSearch = () => {
    const frame = frames.current[active];
    // Setting src again sends the frame back to its starting form as an
    // ordinary step, so Back returns to what the visitor was looking at.
    if (frame) frame.src = FRAMES.find((item) => item.kind === active).src;
    setView((current) => ({ ...current, reloaded: true }));
  };
  // The confirmation is about one press of the button. It clears itself, so it
  // is not still on screen after the visitor has moved on.
  useEffect(() => {
    if (!view.reloaded) return undefined;
    const timer = window.setTimeout(() => setView((current) => ({ ...current, reloaded: false })), RELOADED_NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [view.reloaded]);
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
          <p id={helpId} className="de-idx__help">
            Search properties below, powered by Georgia MLS.{' '}
            {rentalIntent
              ? 'Change the Type boxes to include other property types.'
              : 'For-sale property types are pre-selected; change the Type boxes to include rentals.'}
            {' '}What you choose in the search stays inside Georgia MLS. This
            page’s link does not carry it, so anyone you send the link to
            starts a new search.
          </p>
          <button type="button" className="mf-btn" onClick={startNewSearch}>
            Start a new search
          </button>
          <span className="de-idx__status" role="status">
            {view.reloaded && view.active === active ? 'The search form has been reloaded.' : ''}
          </span>
        </div>
        {FRAMES.filter((item) => opened.includes(item.kind)).map((item) => (
          <iframe
            key={item.kind}
            ref={(node) => { frames.current[item.kind] = node; }}
            loading={loading}
            className="de-idx__frame"
            src={item.src}
            hidden={item.kind !== active}
            title="Georgia MLS property search"
            aria-describedby={helpId}
          />
        ))}
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
