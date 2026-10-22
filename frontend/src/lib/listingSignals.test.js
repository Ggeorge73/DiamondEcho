import { arvChecks, buildListingSignals, estimateHoldingCosts, holdingCostParts, LISTING_THRESHOLDS, monthsSince } from './listingSignals';

// The reference listing of the 2026-10-22 review, typed in as a visitor would:
// bought for $135,000 in April 2025, relisted in January 2026 at $141,900 and
// cut to $93,000 over about nine months, agent-owned, no disclosure, as-is.
const now = new Date(2026, 9, 22);
const listing = {
  purchasePrice: '93000', lastSalePrice: '135000', lastSaleDate: '2025-04', originalListPrice: '141900',
  daysOnMarket: '270', ownerType: 'agent', disclosureStatus: 'none', saleTerms: 'as_is', rehabContingency: '15',
};

test('months since a typed month or date, with nothing for text that is not one', () => {
  expect(monthsSince('2025-04', now)).toBe(18);
  expect(monthsSince('2026-10-01', now)).toBe(0);
  expect(monthsSince('2026-09', now)).toBe(1);
  expect(monthsSince('2027-01', now)).toBeNull();
  expect(monthsSince('April 2025', now)).toBeNull();
  expect(monthsSince('', now)).toBeNull();
});

test('the reference listing raises the four seller cautions and names the facts', () => {
  const result = buildListingSignals(listing, { now });
  expect(result.cautions).toEqual([
    'The seller paid $135,000 18 months ago and is asking $42,000 (31%) less. Selling below their own basis after a short hold usually means a failed project or a problem found; find out which before relying on the budget.',
    'Listed at $141,900 and cut 34% to $93,000 over 270 days on market. The market has already passed at higher prices: verify the after-repair value against sold prices, not asking prices.',
    '270 days on market at this price points to a thin buyer pool. The resale may take longer too: stress the hold period.',
    'The seller is a licensed agent selling their own property and gives no disclosure: assume they know something you do not. Order the inspections, and septic and well tests where they apply, before the diligence period ends.',
  ]);
  // As-is with a 15% contingency is usual, so that one is a note, not a caution.
  expect(result.signals.filter((signal) => signal.level === 'note').map((signal) => signal.text)).toEqual([
    'Sold as-is: the 15% contingency is the only repair credit you will get.',
  ]);
  expect(result.facts.map((fact) => [fact.label, fact.value, fact.detail])).toEqual([
    ['Last sale', '$135,000', '18 months ago'],
    ['Original list price', '$141,900', 'cut 34% to $93,000'],
    ['Days on market', '270 days', 'long for a house priced to sell'],
    ['Seller', 'Sold by a licensed agent selling their own property', 'no disclosure, as-is'],
  ]);
});

test('nothing typed means no facts and no signals', () => {
  const result = buildListingSignals({ purchasePrice: '93000', rehabContingency: '15' }, { now });
  expect(result).toEqual({ facts: [], signals: [], cautions: [] });
});

test('milder facts give notes rather than cautions, and a quick markup is pointed out', () => {
  const mild = buildListingSignals({ ...listing, lastSalePrice: '70000', lastSaleDate: '2025-10', originalListPrice: '99000', daysOnMarket: '65', ownerType: 'investor', disclosureStatus: 'provided', saleTerms: 'standard' }, { now });
  expect(mild.cautions).toEqual([]);
  expect(mild.signals.map((signal) => signal.text)).toEqual([
    'The seller paid $70,000 12 months ago and asks 33% more. Check what work was done for that, and whether it was permitted.',
    'Listed at $99,000 and cut 6% over 65 days on market.',
    '65 days on market: not a quick sale. Allow for a slower resale.',
    'The seller is an investor: expect a priced, professional negotiation and little room on repairs.',
  ]);
  expect(LISTING_THRESHOLDS.bigCutRate).toBe(0.10);
});

test('an as-is sale with a thin contingency, an estate sale, and no disclosure alone each say so', () => {
  const thin = buildListingSignals({ purchasePrice: '93000', saleTerms: 'as_is', rehabContingency: '10' }, { now });
  expect(thin.cautions).toEqual(['Sold as-is with a 10% rehab contingency. 15% to 20% is usual when the seller will not negotiate repairs; the contingency is the only repair credit you will get.']);
  const estate = buildListingSignals({ purchasePrice: '93000', ownerType: 'estate_or_bank', rehabContingency: '15' }, { now });
  expect(estate.signals.map((signal) => signal.level)).toEqual(['note']);
  expect(estate.facts[0].value).toBe('Sold by an estate, bank or relocation company');
  const quiet = buildListingSignals({ purchasePrice: '93000', disclosureStatus: 'none', rehabContingency: '15' }, { now });
  expect(quiet.cautions).toEqual(['No seller disclosure: the inspections are the only account of the house you will get. Order them before the diligence period ends.']);
});

test('a sale below basis long ago is still a caution, without the short-hold clause', () => {
  const old = buildListingSignals({ purchasePrice: '93000', lastSalePrice: '135000', lastSaleDate: '2019-04', rehabContingency: '15' }, { now });
  expect(old.cautions[0]).toContain('Selling below their own basis usually means');
  expect(old.cautions[0]).not.toContain('short hold');
  const undated = buildListingSignals({ purchasePrice: '93000', lastSalePrice: '135000', rehabContingency: '15' }, { now });
  expect(undated.cautions[0]).toMatch(/^The seller paid \$135,000 and is asking/);
  expect(undated.facts[0].detail).toBe('date not entered');
});

describe('holding costs from their parts', () => {
  test('insurance and utilities are estimated from the square feet, and taxes never are', () => {
    expect(estimateHoldingCosts('1655')).toEqual({ flipAnnualInsurance: '1241', flipMonthlyUtilities: '166' });
    expect(estimateHoldingCosts('')).toBeNull();
    expect(estimateHoldingCosts('0')).toBeNull();
  });

  test('the parts add up to a monthly figure', () => {
    const parts = holdingCostParts({ flipAnnualTaxes: '1220', flipAnnualInsurance: '1241', flipMonthlyUtilities: '166' });
    expect(parts.entered).toBe(true);
    expect(parts.total).toBe(371);
    expect(holdingCostParts({ flipAnnualTaxes: '', flipAnnualInsurance: '', flipMonthlyUtilities: '' })).toEqual({ taxes: 0, insurance: 0, utilities: 0, total: 0, entered: false });
  });
});

describe('after-repair value sanity checks', () => {
  const house = { rentableSquareFeet: '1655', arv: '250000', purchasePrice: '93000' };

  test('per-square-foot figures are always shown, with a reminder when there are no comparables', () => {
    const result = arvChecks(house);
    expect(result.facts.map((fact) => [fact.label, fact.value])).toEqual([
      ['After-repair value per square foot', '$151/sf'],
      ['Purchase price per square foot', '$56/sf'],
    ]);
    expect(result.cautions).toEqual([]);
    expect(result.signals[0].text).toContain('A cabin, acreage or new-build sale does not price an older frame house.');
  });

  test('comparables within 10% are in line; further above is a caution; below is a note', () => {
    expect(arvChecks({ ...house, compSoldPerSf: '140' }).signals).toEqual([{ level: 'note', text: 'The after-repair value is in line with the renovated comparable sales entered ($231,700 implied).' }]);
    const high = arvChecks({ ...house, compSoldPerSf: '120' });
    expect(high.cautions).toEqual(['The after-repair value is $151/sf, 26% above the $120/sf of the renovated comparable sales entered, which imply $198,600. Use sold prices of the same kind of house, size, age and setting; a different kind of property does not price this one.']);
    expect(high.facts[2]).toEqual({ key: 'compArv', label: 'Renovated comparable sales', value: '$120/sf', detail: 'imply $198,600 for this size' });
    expect(arvChecks({ ...house, compSoldPerSf: '200' }).signals[0].text).toBe('The after-repair value is 24% below what the comparable sales imply ($331,000); there may be room, or a reason.');
  });

  test('without the square feet the checks ask for them', () => {
    const result = arvChecks({ arv: '250000', purchasePrice: '93000', compSoldPerSf: '140' });
    expect(result.facts).toEqual([]);
    expect(result.signals).toEqual([{ level: 'note', text: 'Enter the square feet to check the after-repair value per square foot.' }]);
  });
});
