// The Intelligence page holds three tools, and each has an address of its own,
// so a search engine can list the mortgage calculator and the seller net sheet
// as pages in their own right and a visitor can be sent straight to one.
export const TOOL_KEYS = ['deal', 'mortgage', 'net-proceeds'];

export const TOOL_PATHS = Object.freeze({
  deal: '/investment-calculator',
  mortgage: '/mortgage-calculator',
  'net-proceeds': '/seller-net-sheet',
});

const withoutClosingSlash = (pathname) => String(pathname || '').replace(/\/+$/, '') || '/';

export const isToolPath = (pathname) => Object.values(TOOL_PATHS).includes(withoutClosingSlash(pathname));

// Before the tools had addresses of their own they were chosen by a "tool"
// part on the Deal Studio address: /investment-calculator?tool=mortgage. Links
// of that kind are still out there (the assistant sends them), so they are
// still read.
export const toolFromSearch = (search) => {
  const requested = new URLSearchParams(search).get('tool');
  return TOOL_KEYS.includes(requested) ? requested : 'deal';
};

export const toolFromLocation = (pathname, search) => {
  const page = withoutClosingSlash(pathname);
  const own = TOOL_KEYS.find((key) => key !== 'deal' && TOOL_PATHS[key] === page);
  if (own) return own;
  return page === TOOL_PATHS.deal ? toolFromSearch(search) : 'deal';
};

// Where an older "?tool=" link should now point, or null when the address is
// already the tool's own. Everything else in the address (a price carried to
// the mortgage calculator, a campaign tag) is kept.
export const currentToolAddress = (pathname, search) => {
  const params = new URLSearchParams(search);
  if (!params.has('tool')) return null;
  const tool = toolFromLocation(pathname, search);
  params.delete('tool');
  const query = params.toString();
  return `${TOOL_PATHS[tool]}${query ? `?${query}` : ''}`;
};

// Moving between the three tools is a tab change, not a new page, so the page
// should stay where the visitor was instead of jumping back to the top. Two
// addresses with the same key do not trigger a scroll.
export const scrollKey = (pathname, search) => {
  const params = new URLSearchParams(search);
  params.delete('tool');
  const page = isToolPath(pathname) ? TOOL_PATHS.deal : pathname;
  return `${page}?${params.toString()}`;
};
