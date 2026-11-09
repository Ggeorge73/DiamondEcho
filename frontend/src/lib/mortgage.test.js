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

// Version 2: loan types, credit bands, counties, cash to close, affordability,
// buydowns, adjustable caps and extra payments. Reference figures worked in
// Python's Decimal, rounding to the cent; see docs/mortgage-simulator-v2.md.
import {
  CREDIT_BANDS, GEORGIA_COUNTIES, LOAN_TYPES, georgiaIntangibleTax, pmiRateFor, sellerConcessionCapPct, loanType, summarizeMortgage, vaFundingFeePct, fhaAnnualMipPct,
} from './mortgage';

const v2 = { ...base, pmiRatePct: undefined };

test('a conventional loan under 20% down takes its PMI rate from the credit band and LTV', () => {
  const result = simulateMortgage({ ...v2, downPayment: '5', creditBand: '740', pmiRateMode: 'auto' });
  expect(result.pmi).toMatchObject({ mode: 'grid', ratePct: 0.53, monthly: 188.81, required: true });
  expect(result.monthly.total).toBe(3490.9);
  expect(pmiRateFor(0.97, '620')).toBe(1.86);
  expect(pmiRateFor(0.81, '760')).toBe(0.19);
  expect(pmiRateFor(0.95, '740')).toBe(0.53);
  expect(pmiRateFor(0.9, '700')).toBe(0.52);
  // A worse score costs more at every LTV, and a higher LTV costs more in every band.
  CREDIT_BANDS.slice(1).forEach((band, index) => expect(pmiRateFor(0.95, band.key)).toBeGreaterThanOrEqual(pmiRateFor(0.95, CREDIT_BANDS[index].key)));
  expect(pmiRateFor(0.97, '740')).toBeGreaterThan(pmiRateFor(0.85, '740'));
  // A typed rate still wins when the visitor chooses it.
  expect(simulateMortgage({ ...v2, downPayment: '5', pmiRateMode: 'manual', pmiRatePct: '0.5' }).pmi).toMatchObject({ mode: 'manual', monthly: 178.13 });
});

test('an FHA loan finances its upfront premium and pays annual MIP for the life of the loan under 10% down', () => {
  const result = simulateMortgage({ ...v2, loanType: 'fha', downPayment: '3.5' });
  expect(result.baseLoan).toBe(434250);
  expect(result.upfront).toMatchObject({ pct: 1.75, amount: 7599.38, financed: true });
  expect(result.loanAmount).toBe(441849.38);
  expect(result.monthly.principalInterest).toBe(2792.79);
  expect(result.pmi).toMatchObject({ mode: 'fha', ratePct: 0.55, monthly: 202.51, lifeOfLoan: true, endsAfterMonth: 360, name: 'FHA mortgage insurance (MIP)' });
  // Declines with the balance.
  expect(result.schedule[359].pmi).toBeLessThan(result.schedule[0].pmi);
  expect(result.cash.lines.intangibleTax).toBe(1326);
  // 10% down: 0.50% for eleven years, then nothing.
  const ten = simulateMortgage({ ...v2, loanType: 'fha', downPayment: '10' });
  expect(ten.pmi).toMatchObject({ ratePct: 0.5, endsAfterMonth: 132, lifeOfLoan: false });
  expect(ten.schedule[132].pmi).toBe(0);
  // Paying the premium at closing instead.
  const paid = simulateMortgage({ ...v2, loanType: 'fha', downPayment: '3.5', financeUpfrontFee: false });
  expect(paid.loanAmount).toBe(434250);
  expect(paid.cash.lines.upfrontAtClosing).toBe(7599.38);
  expect(fhaAnnualMipPct(800000, 0.96, 30)).toBe(0.75);
  expect(fhaAnnualMipPct(400000, 0.8, 15)).toBe(0.15);
  expect(fhaAnnualMipPct(800000, 0.85, 15)).toBe(0.4);
});

test('a VA loan has no mortgage insurance and a funding fee by use and down payment', () => {
  expect(vaFundingFeePct(0, true)).toBe(2.15);
  expect(vaFundingFeePct(0, false)).toBe(3.3);
  expect(vaFundingFeePct(5, true)).toBe(1.5);
  expect(vaFundingFeePct(10, false)).toBe(1.25);
  const result = simulateMortgage({ ...v2, price: '400000', downPayment: '0', loanType: 'va', ratePct: '6.25' });
  expect(result.upfront).toMatchObject({ pct: 2.15, amount: 8600, financed: true });
  expect(result.loanAmount).toBe(408600);
  expect(result.monthly.principalInterest).toBe(2515.82);
  expect(result.pmi.required).toBe(false);
  expect(result.monthly.pmi).toBe(0);
  expect(simulateMortgage({ ...v2, price: '400000', downPayment: '0', loanType: 'va', vaExempt: true }).upfront.amount).toBe(0);
  expect(simulateMortgage({ ...v2, price: '400000', downPayment: '0', loanType: 'va', vaFirstUse: false }).upfront.pct).toBe(3.3);
});

test('a USDA loan finances a 1% guarantee fee and pays a 0.35% annual fee on the balance', () => {
  const result = simulateMortgage({ ...v2, price: '300000', downPayment: '0', loanType: 'usda', ratePct: '6' });
  expect(result.loanAmount).toBe(303000);
  expect(result.monthly.principalInterest).toBe(1816.64);
  expect(result.pmi).toMatchObject({ mode: 'usda', ratePct: 0.35, monthly: 88.38, lifeOfLoan: true });
  expect(result.schedule[359].pmi).toBeGreaterThan(0);
});

test('minimum down payments, occupancy and credit floors are flagged, not silently allowed', () => {
  expect(simulateMortgage({ ...v2, downPayment: '2' }).notes.join(' ')).toContain('Conventional loans need at least 3% down');
  expect(simulateMortgage({ ...v2, loanType: 'fha', downPayment: '3' }).notes.join(' ')).toContain('FHA loans need at least 3.5% down');
  expect(simulateMortgage({ ...v2, loanType: 'fha', downPayment: '3.5', primaryResidence: false }).notes.join(' ')).toContain('FHA loans are for a home you will live in');
  expect(simulateMortgage({ ...v2, downPayment: '5', creditBand: '580' }).notes.join(' ')).toContain('score of 620 or more');
  expect(simulateMortgage({ ...v2, primaryResidence: false }).notes.join(' ')).toContain('no homestead exemption');
  LOAN_TYPES.forEach((type) => expect(loanType(type.key)).toBe(type));
  expect(loanType('nonsense').key).toBe('conventional');
});

test('Georgia intangible tax: $1.50 per $500 or part, capped at $25,000', () => {
  expect(georgiaIntangibleTax(360000)).toBe(1080);
  expect(georgiaIntangibleTax(100001)).toBe(301.5);
  expect(georgiaIntangibleTax(10000000)).toBe(25000);
  expect(georgiaIntangibleTax(0)).toBe(0);
});

test('cash to close adds the down payment, closing costs and prepaids, less credits and earnest money', () => {
  const result = simulateMortgage({
    ...v2, lenderFees: '1500', attorneyTitle: '2500', recordingOther: '250', escrowMonths: '3', prepaidInterestDays: '15', earnestMoney: '5000', appraisalInspection: '1000',
  });
  expect(result.cash.lines).toMatchObject({ intangibleTax: 1080, points: 0, firstYearInsurance: 1800, escrowReserve: 1800, prepaidInterest: 961.64 });
  expect(result.cash.closingCosts).toBe(5330);
  expect(result.cash.prepaids).toBe(4561.64);
  expect(result.cash.dueAtClosing).toBe(94891.64);
  expect(result.cash.totalNeeded).toBe(100891.64);
  // Points cost money at closing; the rate typed is the rate quoted with them.
  expect(simulateMortgage({ ...v2, pointsPct: '1' }).cash.lines.points).toBe(3600);
  // An HOA initiation fee is a closing cost.
  expect(simulateMortgage({ ...v2, hoaInitiation: '1200' }).cash.lines.hoaInitiation).toBe(1200);
});

test('a seller credit is capped by the program and by the costs it may pay', () => {
  expect(sellerConcessionCapPct(loanType('conventional'), 5)).toBe(3);
  expect(sellerConcessionCapPct(loanType('conventional'), 10)).toBe(6);
  expect(sellerConcessionCapPct(loanType('conventional'), 25)).toBe(9);
  expect(sellerConcessionCapPct(loanType('fha'), 3.5)).toBe(6);
  expect(sellerConcessionCapPct(loanType('va'), 0)).toBe(4);
  expect(sellerConcessionCapPct(loanType('usda'), 0)).toBe(6);
  const over = simulateMortgage({ ...v2, downPayment: '5', sellerCredit: '20000', lenderFees: '5000', attorneyTitle: '5000', escrowMonths: '3' });
  expect(over.cash.concessionCapPct).toBe(3);
  expect(over.cash.sellerCredit).toBe(13500);
  expect(over.notes.join(' ')).toContain('at most 3% of the price');
  const tooMuch = simulateMortgage({ ...v2, sellerCredit: '10000', lenderFees: '1000', escrowMonths: '0', prepaidInterestDays: '0' });
  expect(tooMuch.cash.sellerCredit).toBe(tooMuch.cash.closingCosts + tooMuch.cash.prepaids);
  expect(tooMuch.notes.join(' ')).toContain('not the down payment');
});

test('a temporary buydown lowers the early payments and shows what it costs', () => {
  const result = simulateMortgage({ ...v2, buydown: '2-1' });
  expect(result.buydown.years).toHaveLength(2);
  expect(result.buydown.years[0]).toMatchObject({ year: 1, rate: 4.5, principalInterest: 1824.07, total: 2424.07 });
  expect(result.buydown.years[1]).toMatchObject({ year: 2, rate: 5.5, principalInterest: 2044.04 });
  expect(result.buydown.cost).toBe(8193.24);
  // The loan itself amortises at the note rate.
  expect(result.monthly.principalInterest).toBe(2275.44);
  expect(simulateMortgage({ ...v2, buydown: '1-0' }).buydown.years).toHaveLength(1);
  expect(simulateMortgage({ ...v2, buydown: 'none' }).buydown).toBeNull();
});

test('an adjustable loan also shows the worst case its caps allow', () => {
  const result = simulateMortgage({ ...v2, price: '500000', program: 'arm5', ratePct: '6', laterRatePct: '8' });
  expect(result.adjustable.caps).toEqual({ initial: 2, periodic: 1, lifetime: 5 });
  // 6% → 8% in year 6, 9%, 10%, then the 11% ceiling in year 9.
  expect(result.adjustable.worstCase).toMatchObject({ rate: 11, reachedYear: 9 });
  expect(result.adjustable.worstCase.principalInterest).toBeGreaterThan(result.adjustable.principalInterestAfter);
  // $500,000 at 1.2% is $500 a month in taxes, plus $150 insurance.
  expect(result.adjustable.worstCase.total).toBe(result.adjustable.worstCase.principalInterest + 650);
  const seven = simulateMortgage({ ...v2, program: 'arm7', ratePct: '6' });
  expect(seven.adjustable.worstCase).toMatchObject({ rate: 11, reachedYear: 8 });
});

test('extra principal each month shortens a fixed loan and says what it saves', () => {
  const result = simulateMortgage({ ...v2, extraMonthly: '200' });
  expect(result.extra.payoffMonth).toBeLessThan(360);
  expect(result.extra.monthsSaved).toBe(360 - result.extra.payoffMonth);
  expect(result.extra.interestSaved).toBeGreaterThan(50000);
  expect(simulateMortgage({ ...v2, program: 'arm5', extraMonthly: '200' }).extra).toBeNull();
  expect(simulateMortgage(v2).extra).toBeNull();
});

test('affordability: debt-to-income on this purchase and the price the income would carry', () => {
  const result = simulateMortgage({ ...v2, annualIncome: '120000', monthlyDebts: '500' });
  const a = result.affordability;
  expect(a.monthlyIncome).toBe(10000);
  expect(a.backPct).toBeCloseTo(33.75, 1);
  expect(a.frontPct).toBeCloseTo(28.75, 1);
  expect(a.housingCeiling).toBe(4000);
  expect(a.withinLimits).toBe(true);
  expect(a.maxPrice % 1000).toBe(0);
  const at = (price) => simulateMortgage({ ...v2, price: String(price), annualIncome: '120000', monthlyDebts: '500' }).monthly.total;
  expect(at(a.maxPrice)).toBeLessThanOrEqual(4000);
  expect(at(a.maxPrice + 2000)).toBeGreaterThan(4000);
  // FHA has a front-end ceiling too.
  const fha = simulateMortgage({ ...v2, loanType: 'fha', downPayment: '3.5', annualIncome: '90000', monthlyDebts: '900' }).affordability;
  expect(fha.limits).toEqual({ front: 31, back: 43 });
  expect(fha.withinLimits).toBe(false);
  expect(simulateMortgage(v2).affordability).toBeNull();
});

test('a county sets a starting tax rate, labelled as a placeholder', () => {
  expect(GEORGIA_COUNTIES.length).toBeGreaterThanOrEqual(14);
  GEORGIA_COUNTIES.forEach((county) => expect(county.ratePct).toBeGreaterThan(0.5));
  expect(simulateMortgage({ ...v2, county: 'gwinnett' }).county.label).toBe('Gwinnett');
  expect(simulateMortgage({ ...v2, county: 'mars' }).county).toBeNull();
});

test('the summary carries figures only', () => {
  const summary = summarizeMortgage(simulateMortgage({ ...v2, annualIncome: '120000' }));
  expect(summary).toContain('Price $450,000, 20% down ($90,000), Conventional 30-year fixed at 6.5%.');
  expect(summary).toContain('Estimated monthly payment $2,875.');
  expect(summary).toContain('Estimated cash to close');
  expect(summary).toContain('Debt-to-income on this purchase');
  expect(summarizeMortgage(simulateMortgage({}))).toBe('');
});
