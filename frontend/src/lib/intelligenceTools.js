// The Intelligence page holds three tools. The address says which one is open,
// so each can be linked to: /investment-calculator?tool=mortgage.
export const TOOL_KEYS = ['deal', 'mortgage', 'net-proceeds'];

export const toolFromSearch = (search) => {
  const requested = new URLSearchParams(search).get('tool');
  return TOOL_KEYS.includes(requested) ? requested : 'deal';
};

// Switching tools changes only the "tool" part of the address. That is a tab
// change, not a new page, so the page should stay where the visitor was
// instead of jumping back to the top. Two addresses with the same key do not
// trigger a scroll.
export const scrollKey = (pathname, search) => {
  const params = new URLSearchParams(search);
  params.delete('tool');
  return `${pathname}?${params.toString()}`;
};
