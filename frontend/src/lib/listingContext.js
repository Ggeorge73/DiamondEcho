// Legacy sample-listing links are intentionally not resolved to fake property records.
export const resolveListingContext = (search) => {
  const params = new URLSearchParams(search);
  return params.has('listing')
    ? { kind: 'missing', id: params.get('listing') }
    : { kind: 'manual' };
};
