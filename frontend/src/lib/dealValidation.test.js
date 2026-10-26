import { FIELD_LABELS, responseErrorMessage, validateDealForm } from './dealValidation';

const apiError = (detail) => ({ isAxiosError: true, response: { status: 422, data: { detail } } });

test('a rejected input is named, not just described', () => {
  const message = responseErrorMessage(apiError([
    { loc: ['body', 'operating', 'vacancy_rate'], msg: 'Input should be less than 1' },
  ]), 'fallback');
  expect(message).toBe('operating › vacancy rate: Input should be less than 1');
});

test('a rule across several inputs keeps its own wording', () => {
  const message = responseErrorMessage(apiError([
    { loc: ['body', 'debt', 0], msg: 'Value error, interest_only_months cannot exceed term_months' },
  ]), 'fallback');
  expect(message).toBe('debt: interest_only_months cannot exceed term_months');
});

test('repeated and long lists of rejections stay readable', () => {
  const same = { loc: ['body', 'scenarios', 0, 'drivers'], msg: 'Input should be a known driver' };
  expect(responseErrorMessage(apiError([same, same, same]), 'fallback')).toBe('scenarios › drivers: Input should be a known driver');
  const many = ['a', 'b', 'c', 'd', 'e'].map((name) => ({ loc: ['body', name], msg: 'Field required' }));
  expect(responseErrorMessage(apiError(many), 'fallback')).toBe('a: Field required · b: Field required · c: Field required · and 2 more.');
});

test('a plain message from the API is shown as written, with a capital letter', () => {
  expect(responseErrorMessage(apiError('construction financing must leave a positive equity contribution'), 'fallback'))
    .toBe('Construction financing must leave a positive equity contribution');
  expect(responseErrorMessage(apiError('Already capital.'), 'fallback')).toBe('Already capital.');
});

test('an unreachable service says nothing was calculated', () => {
  expect(responseErrorMessage({ isAxiosError: true, message: 'Network Error' }, 'fallback'))
    .toBe('The analysis service could not be reached, so nothing was calculated. Check your connection and try again.');
});

test('a check made in the browser keeps its own message', () => {
  expect(responseErrorMessage(new Error('Vacancy must be at least 0 and no more than 100.'), 'fallback'))
    .toBe('Vacancy must be at least 0 and no more than 100.');
  expect(responseErrorMessage({}, 'fallback')).toBe('fallback');
  expect(responseErrorMessage(apiError([]), 'fallback')).toBe('fallback');
});

// Item 6 of the 2026-10-26 review: messages named field keys ("rehabCost
// cannot be negative"), printed the 9007199254740991 upper bound, and said
// "Rentable square feet" on the land tab, where the box is "Buildable".
describe('validation messages name the box as the page does', () => {
  const flip = {
    strategy: 'flip', units: '1', rentableSquareFeet: '1800', purchasePrice: '180000', closingCosts: '5500',
    dueDiligenceCosts: '1500', initialCapex: '0', holdMonths: '10', ltv: '65', interestRate: '6.75', amortizationYears: '30',
    interestOnlyMonths: '10', loanTermYears: '1', originationFee: '1', sellingCosts: '6', discountRate: '10',
    arv: '360000', rehabCost: '65000', rehabContingency: '10', monthlyHolding: '1800', otherProjectCosts: '6000',
  };
  const message = (form) => { try { validateDealForm(form); return ''; } catch (error) { return error.message; } };

  test('no message prints a field key or the safe-integer limit', () => {
    expect(message({ ...flip, rehabCost: '-1' })).toBe('Rehabilitation budget cannot be negative.');
    expect(message({ ...flip, monthlyHolding: 'abc' })).toBe('Monthly holding costs must be a number.');
    expect(message({ ...flip, arv: '0' })).toBe('After-repair value must be greater than 0.');
    expect(message({ ...flip, purchasePrice: '0' })).toBe('Purchase price must be greater than 0.');
    expect(message({ ...flip, flipMinimumProfit: '-5' })).toBe('Minimum profit must be 0 or more.');
    expect(message({ ...flip, units: '0' })).toBe('Units must be at least 1 and no more than 1000000, in whole numbers.');
  });

  test('the land tab calls the shared boxes by their land names', () => {
    const land = { ...flip, strategy: 'land', rentableSquareFeet: '0', developmentType: 'finished_lots', dispositionStrategy: 'sell_finished_lots', entitlementStatus: 'unentitled', siteAcres: '6', parcelCount: '1', developmentMonths: '12', expectedTerminalValue: '2280000', landContingency: '10' };
    expect(message(land)).toBe('Buildable square feet must be greater than 0.');
    expect(message({ ...land, rentableSquareFeet: '100', units: '0' })).toBe('Planned units / lots must be at least 1 and no more than 1000000, in whole numbers.');
    expect(message({ ...flip, rentableSquareFeet: '0' })).toBe('Rentable square feet must be greater than 0.');
    // A land hold shorter than the build plus the sell-out is refused (second pass of the review).
    expect(message({ ...land, rentableSquareFeet: '100', holdMonths: '3', developmentMonths: '12', absorptionMonths: '12' })).toBe('Hold period must be at least the development schedule plus the absorption (24 months). Lengthen the hold or shorten the schedule.');
    expect(message({ ...land, rentableSquareFeet: '100', holdMonths: '24', developmentMonths: '12', absorptionMonths: '12' })).toBe('');
    expect(message({ ...land, rentableSquareFeet: '100', holdMonths: '12', developmentMonths: '12', absorptionMonths: '0' })).toBe('');
  });

  test('every numeric box the form validates has a label', () => {
    for (const key of Object.keys(FIELD_LABELS)) expect(FIELD_LABELS[key]).toMatch(/^[A-Z]/);
    expect(FIELD_LABELS.rehabCost).toBe('Rehabilitation budget');
  });
});
