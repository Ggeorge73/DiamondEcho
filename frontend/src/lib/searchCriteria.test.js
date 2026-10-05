import {
  MAX_REQUESTED_SEARCH, canonicalSearchParams, normalizeRequestedSearch,
  normalizeStatus, readSearchCriteria, searchPath,
} from './searchCriteria';

describe('requested search text', () => {
  test.each([
    ['  Atlanta  ', 'Atlanta'],
    ['North   Druid\tHills', 'North Druid Hills'],
    ['Sandy\nSprings', 'Sandy Springs'],
    [' Decatur ', 'Decatur'],
    ['   ', ''],
    ['', ''],
    [null, ''],
    [undefined, ''],
    ['Bell\u0007 Road', 'Bell Road'],
  ])('%j becomes %j', (raw, expected) => {
    expect(normalizeRequestedSearch(raw)).toBe(expected);
  });

  test('is capped, and the cap never leaves a trailing space', () => {
    const long = `${'a'.repeat(MAX_REQUESTED_SEARCH - 1)} ${'b'.repeat(50)}`;
    const out = normalizeRequestedSearch(long);
    expect(out.length).toBeLessThanOrEqual(MAX_REQUESTED_SEARCH);
    expect(out).toBe('a'.repeat(MAX_REQUESTED_SEARCH - 1));
  });
});

describe('status', () => {
  test.each(['rent', 'Rent', 'RENT', ' rent ', 'rental', 'Rentals', '\trent\n'])('%j means rentals', (raw) => {
    expect(normalizeStatus(raw)).toBe('rent');
  });
  test.each(['', ' ', 'sale', 'buy', 'rent-to-own', 'renting', 'true', null, undefined])('%j means homes for sale', (raw) => {
    expect(normalizeStatus(raw)).toBe('');
  });
});

describe('address parameters', () => {
  const canonical = (query) => canonicalSearchParams(new URLSearchParams(query)).toString();

  test('reads both criteria in their normal form', () => {
    expect(readSearchCriteria(new URLSearchParams('q=%20%20Atlanta%20&status=%20RENT')))
      .toEqual({ requestedSearch: 'Atlanta', rentalIntent: true });
    expect(readSearchCriteria(new URLSearchParams(''))).toEqual({ requestedSearch: '', rentalIntent: false });
  });

  test.each([
    ['status=Rent', 'status=rent'],
    ['status=%20rent%20', 'status=rent'],
    ['status=rentals', 'status=rent'],
    ['status=sale', ''],
    ['status=', ''],
    ['q=%20%20Atlanta%20%20', 'q=Atlanta'],
    ['q=%20%20', ''],
    ['status=rent&q=Atlanta', 'q=Atlanta&status=rent'],
    ['status=rent&status=sale', 'status=rent'],
  ])('%s is rewritten as %s', (query, expected) => {
    expect(canonical(query)).toBe(expected);
  });

  test('parameters the site does not own are kept as they are', () => {
    expect(canonical('utm_source=mail&status=RENT&ref=a+b')).toBe('utm_source=mail&ref=a+b&status=rent');
  });

  test('an address already in normal form is left alone', () => {
    for (const query of ['', 'status=rent', 'q=Atlanta', 'q=North+Druid+Hills&status=rent']) {
      expect(canonical(query)).toBe(query);
    }
  });

  test('searchPath builds only the two supported forms', () => {
    expect(searchPath()).toBe('/search');
    expect(searchPath({ rentalIntent: true })).toBe('/search?status=rent');
    expect(searchPath({ requestedSearch: '  Atlanta ' })).toBe('/search?q=Atlanta');
    expect(searchPath({ rentalIntent: true, requestedSearch: 'Atlanta' })).toBe('/search?q=Atlanta&status=rent');
  });
});
