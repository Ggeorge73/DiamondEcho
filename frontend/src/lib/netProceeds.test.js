import { calculateNetProceeds, georgiaTransferTax, parseClosingDate, prorateAnnualTax } from './netProceeds';

const base = {
  salePrice: '450000', mortgagePayoff: '250000', otherLiens: '0', listingPct: '3', buyerPct: '2.5',
  closingMode: 'percent', closingCosts: '1.5', transferTaxMode: 'georgia', transferTax: '', recordingFees: '0',
  concessions: '5000', taxMode: 'estimate', annualTax: '5400', closingDate: '2026-06-15', taxBillPaid: false, taxAmount: '', hoaDues: '300', otherCosts: '0',
};
const line = (result, key) => result.items.find((item) => item.key === key);

// O.C.G.A. 48-6-1: $1.00 for the first $1,000 or fractional part, then 10 cents
// for each additional $100 or fractional part. Nothing at $100 or less.
test.each([
  [0, 0], [100, 0], [100.01, 1], [1000, 1], [1000.01, 1.1], [1100, 1.1], [1100.01, 1.2],
  [449999.99, 450], [450000, 450], [450050, 450.1], [1234567, 1234.6],
])('Georgia transfer tax on $%s is $%s', (price, tax) => {
  expect(georgiaTransferTax(price)).toBe(tax);
});

test('closing dates are read without a time zone', () => {
  expect(parseClosingDate('2026-01-01')).toMatchObject({ dayOfYear: 1, daysInYear: 365 });
  expect(parseClosingDate('2026-06-15')).toMatchObject({ dayOfYear: 166, daysInYear: 365 });
  expect(parseClosingDate('2026-12-31')).toMatchObject({ dayOfYear: 365 });
  expect(parseClosingDate('2028-03-01')).toMatchObject({ dayOfYear: 61, daysInYear: 366 });
  expect(parseClosingDate('2028-12-31')).toMatchObject({ dayOfYear: 366 });
  ['', 'soon', '2026-02-30', '2026-13-01', '2027-02-29', '06/15/2026'].forEach((text) => expect(parseClosingDate(text)).toBeNull());
});

test('an unpaid tax bill: the seller owes January 1 to the day before closing', () => {
  expect(prorateAnnualTax({ annualTax: '5400', closingDate: '2026-06-15', billPaid: false }))
    .toEqual({ estimated: true, amount: 2441.1, kind: 'deduction', sellerDays: 165, daysInYear: 365 });
  expect(prorateAnnualTax({ annualTax: '5400', closingDate: '2026-01-01', billPaid: false }).amount).toBe(0);
  expect(prorateAnnualTax({ annualTax: '6000', closingDate: '2028-03-01', billPaid: false }).amount).toBe(983.61);
});

test('a paid tax bill: the buyer gives the seller the rest of the year back', () => {
  expect(prorateAnnualTax({ annualTax: '5400', closingDate: '2026-06-15', billPaid: true }))
    .toEqual({ estimated: true, amount: 2958.9, kind: 'credit', sellerDays: 165, daysInYear: 365 });
});

test('no closing date means no proration, not a guess', () => {
  expect(prorateAnnualTax({ annualTax: '5400', closingDate: '', billPaid: false })).toMatchObject({ estimated: false, amount: 0 });
  const result = calculateNetProceeds({ ...base, closingDate: '' });
  expect(line(result, 'propertyTax')).toBeUndefined();
  expect(result.notes.join(' ')).toContain('choose a closing date');
});

test('the worked example adds up line by line', () => {
  const result = calculateNetProceeds(base);
  expect(result.valid).toBe(true);
  expect(line(result, 'mortgagePayoff').amount).toBe(250000);
  expect(line(result, 'listingCommission').amount).toBe(13500);
  expect(line(result, 'buyerCommission').amount).toBe(11250);
  expect(result.commission).toEqual({ listing: 13500, buyer: 11250, total: 24750, totalPct: 5.5 });
  expect(line(result, 'closingCosts').amount).toBe(6750);
  expect(line(result, 'transferTax')).toMatchObject({ amount: 450, label: 'Georgia transfer tax' });
  expect(line(result, 'concessions').amount).toBe(5000);
  expect(line(result, 'propertyTax')).toMatchObject({ amount: 2441.1, kind: 'deduction' });
  expect(line(result, 'hoaDues').amount).toBe(300);
  // 250,000 + 24,750 + 6,750 + 450 + 5,000 + 2,441.10 + 300
  expect(result.totalDeductions).toBe(289691.1);
  expect(result.net).toBe(160308.9);
  expect(result.netPct).toBeCloseTo(35.6242, 3);
  expect(result.shortfall).toBe(false);
});

test('lines with nothing entered are left out', () => {
  const result = calculateNetProceeds(base);
  expect(result.items.map((item) => item.key)).toEqual(['mortgagePayoff', 'listingCommission', 'buyerCommission', 'closingCosts', 'transferTax', 'concessions', 'propertyTax', 'hoaDues']);
});

test('the staircase starts at the sale price, steps through every line and lands on the net', () => {
  const result = calculateNetProceeds(base);
  const { steps } = result;
  expect(steps[0]).toMatchObject({ key: 'salePrice', kind: 'total', start: 0, end: 450000 });
  expect(steps[1]).toMatchObject({ key: 'mortgagePayoff', start: 450000, end: 200000 });
  for (let i = 2; i < steps.length - 1; i += 1) expect(steps[i].start).toBe(steps[i - 1].end);
  expect(steps[steps.length - 2].end).toBe(result.net);
  expect(steps[steps.length - 1]).toMatchObject({ key: 'net', kind: 'total', start: 0, end: 160308.9, label: 'Estimated net proceeds' });
});

test('a paid tax bill raises the net and steps the staircase up', () => {
  const result = calculateNetProceeds({ ...base, taxBillPaid: true });
  expect(line(result, 'propertyTax')).toMatchObject({ amount: 2958.9, kind: 'credit', label: 'Property tax refunded by the buyer' });
  expect(result.totalCredits).toBe(2958.9);
  expect(result.totalDeductions).toBe(287250);
  expect(result.net).toBe(165708.9);
  const step = result.steps.find((item) => item.key === 'propertyTax');
  expect(step.end).toBeGreaterThan(step.start);
});

test('closing costs, transfer tax and prorated taxes can be typed as amounts', () => {
  const result = calculateNetProceeds({ ...base, closingMode: 'amount', closingCosts: '4200', transferTaxMode: 'amount', transferTax: '500', taxMode: 'amount', taxAmount: '1800', recordingFees: '50', otherLiens: '12000', otherCosts: '650' });
  expect(line(result, 'closingCosts').amount).toBe(4200);
  expect(line(result, 'transferTax')).toMatchObject({ amount: 500, label: 'Transfer tax' });
  expect(line(result, 'propertyTax').amount).toBe(1800);
  expect(line(result, 'recordingFees').amount).toBe(50);
  expect(line(result, 'otherLiens').amount).toBe(12000);
  expect(line(result, 'otherCosts').amount).toBe(650);
  expect(result.net).toBe(150750);
});

test('owing more than the sale brings is shown as a shortfall, not hidden', () => {
  const result = calculateNetProceeds({ ...base, mortgagePayoff: '440000' });
  expect(result.net).toBe(-29691.1);
  expect(result.shortfall).toBe(true);
  expect(result.steps[result.steps.length - 1]).toMatchObject({ label: 'Shortfall at closing', end: -29691.1 });
  expect(result.notes.join(' ')).toContain('bring money to closing');
});

test('no commission entered is pointed out', () => {
  const result = calculateNetProceeds({ ...base, listingPct: '', buyerPct: '' });
  expect(result.commission.total).toBe(0);
  expect(result.notes.join(' ')).toContain('No commission is entered');
});

test('no sale price means no result, and nothing is NaN', () => {
  const result = calculateNetProceeds({});
  expect(result.valid).toBe(false);
  expect(result.net).toBe(0);
  expect(result.items).toEqual([]);
  expect(Number.isFinite(result.netPct)).toBe(true);
});
