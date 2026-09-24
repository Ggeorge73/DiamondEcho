import { applyPropertyAutofill, preparePropertyChange, PROPERTY_ASSUMPTION_FIELDS } from './propertyAutofill';

const previous = {
  address: 'Old home', market: 'Old City, CA', propertyType: 'multifamily',
  strategy: 'rental', ltv: '65', targetIrr: '15', units: '12', annualRent: '360000',
  purchasePrice: '3000000', propertyTaxes: '54000', insurance: '24000',
  rehabCost: '450000', siteWorkCost: '300000', expectedTerminalValue: '4500000',
  developmentType: 'multifamily', dispositionStrategy: 'build_and_sell',
  entitlementStatus: 'fully_entitled', utilityStatus: 'available',
  accessStatus: 'legal_confirmed', environmentalStatus: 'clear',
  geotechnicalStatus: 'complete_suitable',
};

test('clears all enumerated property assumptions on an address switch while keeping investor preferences', () => {
  const next = preparePropertyChange(previous, 'New home');
  PROPERTY_ASSUMPTION_FIELDS.forEach((field) => expect(next[field]).toBe(''));
  expect(next).toMatchObject({ address: 'New home', market: '', propertyType: 'single_family', strategy: 'rental', ltv: '65', targetIrr: '15' });
  expect(next).toMatchObject({
    developmentType: '', dispositionStrategy: '', entitlementStatus: '',
    utilityStatus: 'verify', accessStatus: 'verify',
    environmentalStatus: 'phase_i_required', geotechnicalStatus: 'not_started',
  });
  expect(previous.annualRent).toBe('360000');
});

test('listing autofill uses only attributable listing facts and marks other inputs for review', () => {
  const result = applyPropertyAutofill(previous, {
    source_listing_id: 2, formatted_address: 'Second home', city: 'Miami', state: 'FL',
    property_type: 'Single Family', square_footage: 6800, price: 4500000,
    annual_taxes: 0, is_demo: true, provider: 'DiamondEcho listing',
  }, 'listing');
  expect(result.form).toMatchObject({ address: 'Second home', market: 'Miami, FL', units: '1', rentableSquareFeet: '6800', purchasePrice: '4500000', propertyTaxes: '0', annualRent: '', insurance: '' });
  expect(result.provenance.purchasePrice.description).toMatch(/asking price/);
  expect(result.provenance.propertyTaxes.description).toMatch(/historical/);
  expect(result.reviewFields).toContain('Annual rent or income');
});

test('public record last sale never becomes current acquisition price', () => {
  const result = applyPropertyAutofill(previous, {
    formatted_address: 'Third home', city: 'Austin', state: 'TX',
    square_footage: 4500, last_sale_price: 2500000, annual_taxes: 18000,
    provider: 'rentcast',
  });
  expect(result.form.purchasePrice).toBe('');
  expect(result.form.annualRent).toBe('');
  expect(result.reviewFields).toContain('Historical sale price is context only; enter a current purchase price');
  expect(result.sourceLabel).toMatch(/rentcast public record/);
});

test('missing provider values do not silently reuse previous property values', () => {
  const result = applyPropertyAutofill(previous, { formatted_address: 'Unknown', provider: 'demo' });
  expect(result.form).toMatchObject({ purchasePrice: '', rentableSquareFeet: '', propertyTaxes: '', insurance: '', rehabCost: '' });
  expect(result.reviewFields).toContain('Purchase price or current ask');
  expect(result.sourceLabel).toMatch(/Demo property record/);
});
