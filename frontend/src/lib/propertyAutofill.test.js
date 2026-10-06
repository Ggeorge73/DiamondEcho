import { applyPropertyAutofill, prepareAddressEdit, preparePropertyChange, PROPERTY_ASSUMPTION_FIELDS } from './propertyAutofill';

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

test('illustrative deal data copies descriptive facts but never supplies an asking price', () => {
  const result = applyPropertyAutofill(previous, {
    formatted_address: 'Illustrative address', city: 'Miami', state: 'FL',
    property_type: 'Single Family', square_footage: 6800, price: 4500000,
    annual_taxes: 0, is_demo: true, provider: 'demo',
  });
  expect(result.form).toMatchObject({ address: 'Illustrative address', market: 'Miami, FL', units: '1', rentableSquareFeet: '6800', purchasePrice: '', propertyTaxes: '0', annualRent: '', insurance: '' });
  expect(result.provenance).not.toHaveProperty('purchasePrice');
  expect(result.provenance.propertyTaxes.description).toMatch(/historical/);
  expect(result.reviewFields).toContain('Purchase price or current ask');
  expect(result.sourceLabel).toMatch(/Illustrative deal example/);
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
  expect(result.sourceLabel).toMatch(/Illustrative deal example/);
});

// DE-25: typing an address used to wipe every figure and flip the asset type.
test('typing an address keeps the figures the visitor entered and clears the rest', () => {
  const { form, cleared } = prepareAddressEdit(previous, '1 New Rd', ['purchasePrice', 'annualRent', 'market', 'entitlementStatus']);
  expect(form).toMatchObject({ address: '1 New Rd', purchasePrice: '3000000', annualRent: '360000', market: 'Old City, CA', entitlementStatus: 'fully_entitled' });
  expect(form).toMatchObject({ units: '', propertyTaxes: '', insurance: '', rehabCost: '', siteWorkCost: '', expectedTerminalValue: '' });
  expect(form).toMatchObject({ developmentType: '', dispositionStrategy: '', utilityStatus: 'verify', accessStatus: 'verify', environmentalStatus: 'phase_i_required', geotechnicalStatus: 'not_started' });
  expect(cleared).toMatchObject({ units: '12', propertyTaxes: '54000', utilityStatus: 'available', developmentType: 'multifamily' });
  expect(cleared).not.toHaveProperty('purchasePrice');
  expect(cleared).not.toHaveProperty('market');
});

test('typing an address never changes the asset type, the strategy or the investor preferences', () => {
  for (const [strategy, propertyType] of [['rental', 'multifamily'], ['land', 'land'], ['flip', 'condo']]) {
    const { form } = prepareAddressEdit({ ...previous, strategy, propertyType }, '1 New Rd', []);
    expect(form).toMatchObject({ strategy, propertyType, ltv: '65', targetIrr: '15' });
  }
});

test('what was cleared can be put back exactly, and a second keystroke clears nothing more', () => {
  const first = prepareAddressEdit(previous, '1', ['purchasePrice']);
  expect({ ...first.form, ...first.cleared, address: previous.address }).toEqual(previous);
  const second = prepareAddressEdit(first.form, '1 N', ['purchasePrice']);
  expect(second.cleared).toEqual({});
  expect(second.form).toEqual({ ...first.form, address: '1 N' });
});

test('a property chosen from the list keeps the land tab on Lot / land', () => {
  expect(preparePropertyChange({ ...previous, strategy: 'land', propertyType: 'land' }, 'New parcel').propertyType).toBe('land');
  expect(preparePropertyChange({ ...previous, strategy: 'rental', propertyType: 'multifamily' }, 'New home').propertyType).toBe('single_family');
});
