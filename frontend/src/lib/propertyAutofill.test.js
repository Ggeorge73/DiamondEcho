import { applyAutofillProfile, assumptionsByField, buildReviewAutofillProfile } from './propertyAutofill';

test('applies researched inputs while preserving the resolved address and strategy', () => {
  const profile = {
    strategy: 'rental',
    property: { formatted_address: '827 Oak St NW, Atlanta, GA 30318' },
    inputs: { annualRent: '52800', propertyTaxes: '4200' },
    assumptions: [{ field: 'annualRent', confidence: 'medium' }],
  };
  const next = applyAutofillProfile({ address: 'Oak', strategy: 'flip', annualRent: '0' }, profile);
  expect(next.address).toBe('827 Oak St NW, Atlanta, GA 30318');
  expect(next.strategy).toBe('rental');
  expect(next.annualRent).toBe('52800');
  expect(assumptionsByField(profile).annualRent.confidence).toBe('medium');
});

test('review profile fills the current input surface and labels it as review data', () => {
  const currentForm = { address: '', strategy: 'rental', vacancy: '5', interestRate: '7.25' };
  const profile = buildReviewAutofillProfile({
    property: { address: '1 Test St', city: 'Atlanta', state: 'GA', zip: '30318', price: 400000, sqft: 2000, yearBuilt: 2000, propertyType: 'Single Family', taxHistory: [{ amount: 4000 }] },
    strategy: 'rental', currentForm,
  });
  expect(profile.inputs.purchasePrice).toBe('400000');
  expect(profile.inputs.vacancy).toBe('5');
  expect(profile.inputs.annualRent).not.toBe('');
  expect(profile.assumptions.every((item) => item.source_kind === 'review_default')).toBe(true);
});
