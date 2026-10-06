import { classifyFloodZone, floodZoneVerified, floodZoneWarning } from './floodZone';

// The same table as backend/tests/deal_intelligence/test_engine.py: the page
// and the analysis service must read what was typed the same way.
test.each([
  ['', 'not_entered', ''], ['   ', 'not_entered', ''], [undefined, 'not_entered', ''], [null, 'not_entered', ''],
  ['Not verified', 'unrecognized', ''], ['unknown', 'unrecognized', ''], ['A31', 'unrecognized', ''],
  ['x', 'minimal', 'X'], [' zone  x ', 'minimal', 'X'], ['C', 'minimal', 'C'],
  ['FEMA Flood Zone X (shaded)', 'moderate', 'X (SHADED)'], ['X500', 'moderate', 'X500'], ['B', 'moderate', 'B'],
  ['ae', 'special', 'AE'], ['Zone AE', 'special', 'AE'], ['A12', 'special', 'A12'], ['VE', 'special', 'VE'],
  ['AR/AE', 'special', 'AR/AE'], ['D', 'undetermined', 'D'],
])('"%s" is read as %s', (text, status, zone) => {
  expect(classifyFloodZone(text)).toEqual({ status, zone });
});

// DE-25: typing "Not verified" raised the warning meant for an entered hazard zone.
test('text that is not a FEMA zone is reported as not verified, never as a hazard zone', () => {
  for (const text of ['Not verified', 'n/a', 'TBD', '']) {
    expect(floodZoneVerified(text)).toBe(false);
    expect(floodZoneWarning(text)).toBe('The FEMA flood zone is not verified; confirm the designation, base flood elevation, and insurance requirement.');
  }
});

test('warnings follow the designation', () => {
  expect(floodZoneWarning('X')).toBeNull();
  expect(floodZoneWarning('ae')).toBe('Flood zone AE is a FEMA Special Flood Hazard Area; floodplain, stormwater, elevation, insurance, and buildable-area review is required.');
  expect(floodZoneWarning('X (shaded)')).toContain('moderate flood-hazard area');
  expect(floodZoneWarning('D')).toContain('has not determined the flood hazard');
  for (const text of ['X', 'AE', 'X500', 'D']) expect(floodZoneVerified(text)).toBe(true);
});
