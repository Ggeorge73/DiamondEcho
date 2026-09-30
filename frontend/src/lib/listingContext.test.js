import { resolveListingContext } from './listingContext';

test('legacy sample-listing links never resolve to local property records', () => {
  expect(resolveListingContext('')).toEqual({ kind: 'manual' });
  expect(resolveListingContext('?listing=1')).toEqual({ kind: 'missing', id: '1' });
  expect(resolveListingContext('?listing=999')).toEqual({ kind: 'missing', id: '999' });
  expect(resolveListingContext('?listing=')).toEqual({ kind: 'missing', id: '' });
});
