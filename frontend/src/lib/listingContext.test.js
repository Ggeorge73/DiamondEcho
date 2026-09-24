import { properties } from '../data/mockData';
import { recordFromListing, resolveListingContext } from './listingContext';

test('resolves two distinct listing links without substituting an example property', () => {
  const first = resolveListingContext('?listing=1', properties);
  const second = resolveListingContext('?listing=2', properties);
  expect(first.kind).toBe('listing');
  expect(second.kind).toBe('listing');
  expect(recordFromListing(first.listing)).toMatchObject({
    source_listing_id: 1, price: 4500000, city: 'Miami Beach', state: 'FL',
    formatted_address: '1245 Ocean Drive, Miami Beach, FL 33139',
  });
  expect(recordFromListing(second.listing)).toMatchObject({
    source_listing_id: 2, price: 6200000, city: 'Los Angeles', state: 'CA',
    formatted_address: '789 Sunset Boulevard, Los Angeles, CA 90069',
  });
});

test('keeps manual and invalid listing links distinct', () => {
  expect(resolveListingContext('', properties)).toEqual({ kind: 'manual' });
  expect(resolveListingContext('?listing=1oops', properties)).toEqual({ kind: 'missing', id: '1oops' });
  expect(resolveListingContext('?listing=999', properties)).toEqual({ kind: 'missing', id: '999' });
  expect(resolveListingContext('?listing=', properties)).toEqual({ kind: 'missing', id: '' });
});

test('uses asking price without inventing a prior sale price', () => {
  const record = recordFromListing(properties[0]);
  expect(record.price).toBe(properties[0].price);
  expect(record).not.toHaveProperty('last_sale_price');
});
