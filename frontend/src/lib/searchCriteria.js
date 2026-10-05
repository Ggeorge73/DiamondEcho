// DE-21. The only search criteria DiamondEcho itself owns are the two below.
// Everything a visitor chooses inside the Georgia MLS frame (city, price, beds,
// type boxes, sort) belongs to Georgia MLS: this site cannot read it, cannot put
// it in its own address, and so cannot keep it across a shared link.
//
//   status=rent   open the search with Rental (Residential) pre-selected
//   q=<text>      what an older link was looking for; shown as a note only and
//                 never sent to Georgia MLS
//
// See docs/gamls-search-integration.md, "Link parameters and history".

export const MAX_REQUESTED_SEARCH = 80;

const RENT_WORDS = ['rent', 'rental', 'rentals'];

// Trims, turns runs of spaces, tabs and line breaks into one space, drops
// control characters and caps the length.
export const normalizeRequestedSearch = (raw) => String(raw ?? '')
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u001F\u007F]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, MAX_REQUESTED_SEARCH)
  .trim();

// 'rent' for any spelling of rent this site has used or a visitor might type;
// '' (homes for sale) for everything else, including an empty value.
export const normalizeStatus = (raw) => (
  RENT_WORDS.includes(String(raw ?? '').trim().toLowerCase()) ? 'rent' : ''
);

export const readSearchCriteria = (params) => ({
  requestedSearch: normalizeRequestedSearch(params.get('q')),
  rentalIntent: normalizeStatus(params.get('status')) === 'rent',
});

// The same parameters with q and status in their normal form. Parameters this
// site does not own (a campaign tag, for example) are left exactly as they are.
export const canonicalSearchParams = (params) => {
  const next = new URLSearchParams(params);
  const { requestedSearch, rentalIntent } = readSearchCriteria(params);
  next.delete('q');
  next.delete('status');
  if (requestedSearch) next.set('q', requestedSearch);
  if (rentalIntent) next.set('status', 'rent');
  return next;
};

export const searchPath = ({ rentalIntent = false, requestedSearch = '' } = {}) => {
  const params = new URLSearchParams();
  const text = normalizeRequestedSearch(requestedSearch);
  if (text) params.set('q', text);
  if (rentalIntent) params.set('status', 'rent');
  const query = params.toString();
  return query ? `/search?${query}` : '/search';
};
