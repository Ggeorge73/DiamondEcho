import {
  amount, DEFAULT_PROPERTY_TAX_RATE, LOAN_PROGRAMS, monthlyPayment, mortgagePrefillFromSearch, paymentParts, simulateMortgage,
} from './mortgage';

// Reference figures were worked separately in decimal arithmetic (Python's
// Decimal, rounding each month to the cent); see docs/buyer-seller-calculators.md.
const base = {
  price: '450000', downPaymentMode: 'percent', downPayment: '20', program: 'fixed30', ratePct: '6.5',
  propertyTaxMode: 'percent', propertyTax: String(DEFAULT_PROPERTY_TAX_RATE), insuranceMode: 'year', insurance: '1800', hoaMonthly: '0', pmiRatePct: '0.5',
};

test('blank, negative and unreadable entries count as zero', () => {
  expect(amount('')).toBe(0);
  expect(amount('-5')).toBe(0);
  expect(amount('abc')).toBe(0);
  expect(amount(undefined)).toBe(0);
  expect(amount('$1,250.50')).toBe(1250.5);
});

test('the level payment matches the standard formula', () => {
  expect(monthlyPayment(360000, 6.5, 360)).toBe(2275.44);
  expect(monthlyPayment(300000, 5.75, 180)).toBe(2491.23);
  expect(monthlyPayment(240000, 0, 240)).toBe(1000);
  expect(monthlyPayment(0, 6.5, 360)).toBe(0);
});

test('20% down on $450,000 at 6.5% for 30 years', () => {
  const result = simulateMortgage(base);
  expect(result.valid).toBe(true);
  expect(result.downPayment).toBe(90000);
  expect(result.loanAmount).toBe(360000);
  expect(result.monthly).toEqual({ principalInterest: 2275.44, propertyTax: 450, insurance: 150, hoa: 0, pmi: 0, total: 2875.44 });
  expect(result.pmi.required).toBe(false);
  expect(result.schedule).toHaveLength(360);
  expect(result.schedule[0]).toMatchObject({ month: 1, principal: 325.44, interest: 1950, balance: 359674.56 });
  expect(result.schedule[11].balance).toBe(355976.26);
  expect(result.schedule[359]).toMatchObject({ payment: 2281.04, balance: 0 });
  expect(result.totals.interest).toBe(459164);
  expect(result.totals.principal).toBe(360000);
});

test('the schedule agrees with the closed-form balance to within rounding', () => {
  const { schedule } = simulateMortgage(base);
  const i = 6.5 / 1200;
  const exactPayment = (360000 * i) / (1 - (1 + i) ** -360);
  [12, 60, 120, 240, 300].forEach((k) => {
    const exact = 360000 * (1 + i) ** k - exactPayment * (((1 + i) ** k - 1) / i);
    // The schedule rounds the payment and each month's interest to the cent.
    expect(Math.abs(schedule[k - 1].balance - exact)).toBeLessThan(5);
  });
});

test('the yearly view adds up to the monthly one', () => {
  const result = simulateMortgage(base);
  expect(result.years).toHaveLength(30);
  expect(result.years[0]).toMatchObject({ year: 1, interest: 23281.54, balance: 355976.26 });
  const total = (key) => Math.round(result.years.reduce((sum, year) => sum + year[key], 0) * 100) / 100;
  expect(total('interest')).toBe(result.totals.interest);
  expect(total('principal')).toBe(360000);
  expect(result.years[29].balance).toBe(0);
});

test('under 20% down adds mortgage insurance, which ends when the balance reaches 78% of the price', () => {
  const result = simulateMortgage({ ...base, downPayment: '5' });
  expect(result.loanAmount).toBe(427500);
  expect(result.pmi).toMatchObject({ required: true, monthly: 178.13, endsAfterMonth: 135, total: 24047.55 });
  expect(result.monthly.principalInterest).toBe(2702.09);
  expect(result.monthly.pmi).toBe(178.13);
  expect(result.monthly.total).toBe(3480.22);
  // Still charged in the last month the balance starts above 78%, not after.
  expect(result.schedule[134].pmi).toBe(178.13);
  expect(result.schedule[135].pmi).toBe(0);
  expect(result.schedule[133].balance).toBeGreaterThan(450000 * 0.78);
  expect(result.schedule[134].balance).toBeLessThanOrEqual(450000 * 0.78);
  expect(result.totals.interest).toBe(545253.1);
});

test('exactly 20% down has no mortgage insurance, and one dollar less does', () => {
  expect(simulateMortgage({ ...base, downPaymentMode: 'amount', downPayment: '90000' }).pmi.required).toBe(false);
  expect(simulateMortgage({ ...base, downPaymentMode: 'amount', downPayment: '89999' }).pmi.required).toBe(true);
});

test('mortgage insurance stops at the midpoint of the term at the latest', () => {
  // Interest-heavy loan: at 12% the balance is still above 78% at the midpoint.
  const result = simulateMortgage({ ...base, downPayment: '3', ratePct: '12' });
  expect(result.pmi.endsAfterMonth).toBe(180);
  expect(result.schedule[179].balance).toBeGreaterThan(450000 * 0.78);
  expect(result.schedule[180].pmi).toBe(0);
});

test('a dollar down payment and a percentage down payment give the same loan', () => {
  const byPercent = simulateMortgage({ ...base, downPayment: '10' });
  const byAmount = simulateMortgage({ ...base, downPaymentMode: 'amount', downPayment: '45000' });
  expect(byAmount.loanAmount).toBe(byPercent.loanAmount);
  expect(byAmount.downPaymentPct).toBeCloseTo(10, 10);
  expect(byAmount.monthly).toEqual(byPercent.monthly);
});

test('15-year and 20-year terms', () => {
  const fifteen = simulateMortgage({ ...base, price: '375000', program: 'fixed15', ratePct: '5.75' });
  expect(fifteen.loanAmount).toBe(300000);
  expect(fifteen.schedule).toHaveLength(180);
  expect(fifteen.monthly.principalInterest).toBe(2491.23);
  expect(fifteen.totals.interest).toBe(148421.55);
  expect(fifteen.schedule[179]).toMatchObject({ payment: 2491.38, balance: 0 });
  const twenty = simulateMortgage({ ...base, price: '300000', program: 'fixed20', ratePct: '0' });
  expect(twenty.monthly.principalInterest).toBe(1000);
  expect(twenty.totals.interest).toBe(0);
  expect(twenty.notes.join(' ')).toContain('No interest rate is entered');
});

test('an adjustable loan holds its rate, then moves once to the rate entered', () => {
  const result = simulateMortgage({ ...base, price: '500000', program: 'arm5', ratePct: '6', laterRatePct: '8' });
  expect(result.loanAmount).toBe(400000);
  expect(result.monthly.principalInterest).toBe(2398.2);
  expect(result.schedule[59]).toMatchObject({ rate: 6, payment: 2398.2, balance: 372217.58 });
  expect(result.schedule[60]).toMatchObject({ rate: 8, payment: 2872.84 });
  expect(result.adjustable).toMatchObject({ fixedYears: 5, laterRate: 8, principalInterestAfter: 2872.84 });
  expect(result.adjustable.totalAfter).toBe(3522.84);
  expect(result.schedule).toHaveLength(360);
  expect(result.schedule[359].balance).toBe(0);
  expect(result.totals.interest).toBe(605739.73);
});

test('an adjustable loan with no later rate keeps the starting rate and says so', () => {
  const result = simulateMortgage({ ...base, program: 'arm7', laterRatePct: '' });
  expect(result.adjustable.laterRate).toBe(6.5);
  expect(result.adjustable.principalInterestAfter).toBeCloseTo(result.monthly.principalInterest, 0);
  expect(result.notes.join(' ')).toContain('No later rate is entered');
});

test('taxes, insurance and HOA can be entered either way', () => {
  const result = simulateMortgage({ ...base, propertyTaxMode: 'amount', propertyTax: '6000', insuranceMode: 'month', insurance: '175', hoaMonthly: '125' });
  expect(result.annualTax).toBe(6000);
  expect(result.annualInsurance).toBe(2100);
  expect(result.monthly).toMatchObject({ propertyTax: 500, insurance: 175, hoa: 125, total: 3075.44 });
});

test('paying cash leaves only taxes, insurance and HOA', () => {
  const result = simulateMortgage({ ...base, downPayment: '100', hoaMonthly: '50' });
  expect(result.loanAmount).toBe(0);
  expect(result.schedule).toHaveLength(0);
  expect(result.monthly.total).toBe(650);
  expect(result.notes.join(' ')).toContain('there is no loan');
});

test('a down payment above the price is held at the price', () => {
  const result = simulateMortgage({ ...base, downPaymentMode: 'amount', downPayment: '900000' });
  expect(result.downPayment).toBe(450000);
  expect(result.loanAmount).toBe(0);
});

test('no price means no result, and nothing is NaN', () => {
  const result = simulateMortgage({});
  expect(result.valid).toBe(false);
  expect(result.monthly.total).toBe(0);
  expect(JSON.stringify(result)).not.toContain('null,null');
  Object.values(result.monthly).forEach((value) => expect(Number.isFinite(value)).toBe(true));
});

test('the payment parts add up to the total, in a fixed order', () => {
  const result = simulateMortgage({ ...base, downPayment: '5', hoaMonthly: '85' });
  const parts = paymentParts(result);
  expect(parts.map((part) => part.key)).toEqual(['principalInterest', 'propertyTax', 'insurance', 'hoa', 'pmi']);
  expect(Math.round(parts.reduce((sum, part) => sum + part.value, 0) * 100) / 100).toBe(result.monthly.total);
});

test('every loan choice repays in full', () => {
  LOAN_PROGRAMS.forEach((program) => {
    const result = simulateMortgage({ ...base, program: program.key, laterRatePct: '9' });
    expect(result.schedule).toHaveLength(program.years * 12);
    expect(result.schedule[result.schedule.length - 1].balance).toBe(0);
    expect(result.totals.principal).toBe(360000);
  });
});

test('a link can carry a price, taxes and HOA fee, and nothing else', () => {
  expect(mortgagePrefillFromSearch('?tool=mortgage&price=525000&taxes=6100&hoa=140')).toEqual({ price: 525000, taxes: 6100, hoa: 140 });
  expect(mortgagePrefillFromSearch('?tool=mortgage&price=525000')).toEqual({ price: 525000, taxes: null, hoa: null });
  expect(mortgagePrefillFromSearch('?tool=mortgage')).toBeNull();
  expect(mortgagePrefillFromSearch('?price=abc')).toBeNull();
  expect(mortgagePrefillFromSearch('?price=-5')).toBeNull();
  expect(mortgagePrefillFromSearch('?price=1e9')).toBeNull();
  expect(mortgagePrefillFromSearch('?price=<script>')).toBeNull();
  expect(mortgagePrefillFromSearch('?price=400000&taxes=junk&hoa=999999999')).toEqual({ price: 400000, taxes: null, hoa: null });
});
