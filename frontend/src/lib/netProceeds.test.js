import {
  calculateNetProceeds, compareOffers, daysBetween, estimatePayoff, firptaPct, georgiaTransferTax, parseClosingDate, prorateAnnualTax, prorateDues, summarizeNetSheet,
} from './netProceeds';

// Version 2 example: $450,000 sale closing 2026-06-15; $250,000 balance at
// 6.25% paid through June 1; 3% listing, 2.5% buyer brokerage; $150 payoff
// processing; $5,000 contribution; $5,400 tax bill unpaid; $300 monthly dues
// paid ahead. Reference figures worked in Python's Decimal; see
// docs/seller-net-sheet-v2.md.
const base = {
  salePrice: '450000', closingDate: '2026-06-15',
  payoffMode: 'estimate', mortgageBalance: '250000', mortgageRate: '6.25', paidThrough: '2026-06-01', payoffCushionDays: '2', payoffReleaseFee: '50',
  secondLien: '', otherLiens: '0',
  listingPct: '3', buyerPct: '2.5',
  transferTaxPayer: 'buyer', transferTaxMode: 'georgia', transferTax: '', deedPrep: '150',
  payoffProcessing: '150', titleClearance: '', mailAway: '', homeWarranty: '', recordingFees: '0', otherCosts: '0',
  concessions: '5000', repairCredits: '',
  taxMode: 'estimate', annualTax: '5400', taxBillPaid: false, taxAmount: '',
  hoaDues: '300', hoaPeriod: 'month', hoaPaid: true, hoaPastDue: '', hoaLetterFee: '', hoaLetterPayer: 'seller', hoaTransferFee: '', hoaTransferPayer: 'buyer',
  sellerResidency: 'georgia', principalResidence: true, buyerWillOccupy: true, gaWithholdingMode: 'price', gainAmount: '',
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
  expect(daysBetween(parseClosingDate('2026-06-01'), parseClosingDate('2026-06-15'))).toBe(14);
  expect(daysBetween(parseClosingDate('2025-12-20'), parseClosingDate('2026-01-05'))).toBe(16);
  expect(daysBetween(parseClosingDate('2028-02-20'), parseClosingDate('2028-03-05'))).toBe(14);
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

test('association dues are prorated over the period that holds the closing', () => {
  expect(prorateDues({ dues: '300', period: 'month', closingDate: '2026-06-15', paid: true })).toEqual({ estimated: true, amount: 160, kind: 'credit', sellerDays: 14, periodDays: 30 });
  expect(prorateDues({ dues: '300', period: 'month', closingDate: '2026-06-15', paid: false })).toMatchObject({ amount: 140, kind: 'deduction' });
  expect(prorateDues({ dues: '900', period: 'quarter', closingDate: '2026-06-15', paid: true })).toEqual({ estimated: true, amount: 158.24, kind: 'credit', sellerDays: 75, periodDays: 91 });
  expect(prorateDues({ dues: '1200', period: 'year', closingDate: '2026-06-15', paid: false })).toMatchObject({ amount: 542.47, sellerDays: 165, periodDays: 365 });
  expect(prorateDues({ dues: '300', period: 'month', closingDate: '', paid: true })).toMatchObject({ estimated: false, amount: 0 });
});

test('a payoff is the balance plus interest to the wire, a cushion and the release fee', () => {
  const payoff = estimatePayoff({ balance: '250000', ratePct: '6.25', paidThrough: '2026-06-01', closingDate: '2026-06-15', cushionDays: '2', releaseFee: '50' });
  expect(payoff).toMatchObject({ estimated: true, principal: 250000, perDiem: 42.81, interestDays: 16, interest: 684.96, releaseFee: 50, total: 250734.96 });
  // No paid-through date: interest runs from the first of the closing month.
  expect(estimatePayoff({ balance: '250000', ratePct: '6.25', paidThrough: '', closingDate: '2026-06-15', cushionDays: '2', releaseFee: '0' }).interestDays).toBe(16);
  // No closing date: the balance alone, flagged as not estimated.
  expect(estimatePayoff({ balance: '250000', ratePct: '6.25', paidThrough: '', closingDate: '', cushionDays: '2', releaseFee: '0' })).toMatchObject({ estimated: false, total: 250000 });
  expect(estimatePayoff({ balance: '0', ratePct: '6', closingDate: '2026-06-15' }).total).toBe(0);
});

test('the worked example adds up line by line', () => {
  const result = calculateNetProceeds(base);
  expect(result.valid).toBe(true);
  expect(line(result, 'mortgagePayoff')).toMatchObject({ amount: 250734.96, label: 'Mortgage payoff (estimated)' });
  expect(line(result, 'listingCommission').amount).toBe(13500);
  expect(line(result, 'buyerCommission').amount).toBe(11250);
  expect(result.commission).toEqual({ listing: 13500, buyer: 11250, total: 24750, totalPct: 5.5 });
  // Transfer tax and deed prep are the buyer's under the GAR default.
  expect(line(result, 'transferTax')).toBeUndefined();
  expect(line(result, 'deedPrep')).toBeUndefined();
  expect(result.transferTax).toBe(450);
  expect(line(result, 'payoffProcessing').amount).toBe(150);
  expect(line(result, 'cancellationRecording')).toMatchObject({ amount: 25, label: 'Recording the lien cancellation' });
  expect(line(result, 'concessions').amount).toBe(5000);
  expect(line(result, 'propertyTax')).toMatchObject({ amount: 2441.1, kind: 'deduction' });
  expect(line(result, 'hoaDues')).toMatchObject({ amount: 160, kind: 'credit', label: 'Association dues refunded by the buyer' });
  expect(result.totalDeductions).toBe(283101.06);
  expect(result.totalCredits).toBe(160);
  expect(result.net).toBe(167058.94);
  expect(result.shortfall).toBe(false);
  expect(result.notes.join(' ')).toContain('GAR contract default');
});

test('moving transfer tax and deed preparation to the seller adds both lines', () => {
  const result = calculateNetProceeds({ ...base, transferTaxPayer: 'seller' });
  expect(line(result, 'transferTax')).toMatchObject({ amount: 450, label: 'Georgia transfer tax' });
  expect(line(result, 'deedPrep').amount).toBe(150);
  expect(result.net).toBe(167058.94 - 600);
  expect(result.notes.join(' ')).not.toContain('GAR contract default');
  const typed = calculateNetProceeds({ ...base, transferTaxPayer: 'seller', transferTaxMode: 'amount', transferTax: '500' });
  expect(line(typed, 'transferTax')).toMatchObject({ amount: 500, label: 'Transfer tax' });
});

test('the payoff can be the figure from the lender\'s letter instead', () => {
  const result = calculateNetProceeds({ ...base, payoffMode: 'letter', mortgagePayoff: '251000' });
  expect(line(result, 'mortgagePayoff')).toMatchObject({ amount: 251000, label: 'Mortgage payoff' });
  // Version-1 inputs still read.
  const old = calculateNetProceeds({ salePrice: '450000', mortgagePayoff: '250000', listingPct: '3', buyerPct: '2.5', closingMode: 'percent', closingCosts: '1.5' });
  expect(line(old, 'mortgagePayoff').amount).toBe(250000);
  expect(line(old, 'closingCosts').amount).toBe(6750);
});

test('each lien paid off records a cancellation', () => {
  const result = calculateNetProceeds({ ...base, secondLien: '40000', otherLiens: '2500' });
  expect(line(result, 'secondLien').amount).toBe(40000);
  expect(line(result, 'cancellationRecording')).toMatchObject({ amount: 75, label: 'Recording 3 lien cancellations' });
});

test('a nonresident seller has 3% withheld, unless the home was their principal residence', () => {
  const resident = calculateNetProceeds({ ...base, sellerResidency: 'georgia', principalResidence: false });
  expect(line(resident, 'gaWithholding')).toBeUndefined();
  const exempt = calculateNetProceeds({ ...base, sellerResidency: 'us', principalResidence: true });
  expect(line(exempt, 'gaWithholding')).toBeUndefined();
  expect(exempt.withholding.gaNote).toBe('exempt: principal residence');
  const withheld = calculateNetProceeds({ ...base, sellerResidency: 'us', principalResidence: false });
  expect(line(withheld, 'gaWithholding')).toMatchObject({ amount: 13500, label: 'Georgia nonresident withholding (3% of price)' });
  expect(withheld.net).toBe(167058.94 - 13500);
  expect(withheld.notes.join(' ')).toContain('O.C.G.A. 48-7-128');
  const onGain = calculateNetProceeds({ ...base, sellerResidency: 'us', principalResidence: false, gaWithholdingMode: 'gain', gainAmount: '80000' });
  expect(line(onGain, 'gaWithholding')).toMatchObject({ amount: 2400, label: 'Georgia nonresident withholding (3% of gain)' });
  const smallGain = calculateNetProceeds({ ...base, sellerResidency: 'us', principalResidence: false, gaWithholdingMode: 'gain', gainAmount: '10000' });
  expect(line(smallGain, 'gaWithholding')).toBeUndefined();
  expect(smallGain.withholding.gaNote).toContain('under $600');
  expect(calculateNetProceeds({ ...base, salePrice: '15000', sellerResidency: 'us', principalResidence: false }).withholding.gaNote).toContain('under $20,000');
});

test('FIRPTA applies to a seller who is not a US resident, by price and the buyer\'s use', () => {
  expect(firptaPct(450000, true)).toBe(10);
  expect(firptaPct(450000, false)).toBe(15);
  expect(firptaPct(300000, true)).toBe(0);
  expect(firptaPct(1000000, true)).toBe(10);
  expect(firptaPct(1000001, true)).toBe(15);
  const foreign = calculateNetProceeds({ ...base, sellerResidency: 'foreign', principalResidence: false });
  expect(line(foreign, 'gaWithholding').amount).toBe(13500);
  expect(line(foreign, 'firpta')).toMatchObject({ amount: 45000, label: 'FIRPTA federal withholding (10%)' });
  expect(foreign.net).toBe(167058.94 - 13500 - 45000);
  const investor = calculateNetProceeds({ ...base, sellerResidency: 'foreign', principalResidence: true, buyerWillOccupy: false });
  // Principal residence exempts Georgia's withholding, not FIRPTA.
  expect(line(investor, 'gaWithholding')).toBeUndefined();
  expect(line(investor, 'firpta').amount).toBe(67500);
  const small = calculateNetProceeds({ ...base, salePrice: '280000', sellerResidency: 'foreign' });
  expect(line(small, 'firpta')).toBeUndefined();
  expect(small.notes.join(' ')).toContain('no withholding because the price is $300,000 or less');
});

test('association letter and transfer fees follow who pays them', () => {
  const result = calculateNetProceeds({ ...base, hoaLetterFee: '250', hoaTransferFee: '1000', hoaPastDue: '450' });
  expect(line(result, 'hoaLetterFee').amount).toBe(250);
  expect(line(result, 'hoaTransferFee')).toBeUndefined();
  expect(line(result, 'hoaPastDue').amount).toBe(450);
  const shifted = calculateNetProceeds({ ...base, hoaLetterFee: '250', hoaLetterPayer: 'buyer', hoaTransferFee: '1000', hoaTransferPayer: 'seller' });
  expect(line(shifted, 'hoaLetterFee')).toBeUndefined();
  expect(line(shifted, 'hoaTransferFee').amount).toBe(1000);
  const unpaid = calculateNetProceeds({ ...base, hoaPaid: false });
  expect(line(unpaid, 'hoaDues')).toMatchObject({ amount: 140, kind: 'deduction', label: 'Prorated association dues' });
});

test('lines with nothing entered are left out', () => {
  const result = calculateNetProceeds(base);
  expect(result.items.map((item) => item.key)).toEqual(['mortgagePayoff', 'listingCommission', 'buyerCommission', 'payoffProcessing', 'cancellationRecording', 'concessions', 'propertyTax', 'hoaDues']);
});

test('the staircase starts at the sale price, steps through every line and lands on the net', () => {
  const result = calculateNetProceeds(base);
  const { steps } = result;
  expect(steps[0]).toMatchObject({ key: 'salePrice', kind: 'total', start: 0, end: 450000 });
  expect(steps[1]).toMatchObject({ key: 'mortgagePayoff', start: 450000, end: 199265.04 });
  for (let i = 2; i < steps.length - 1; i += 1) expect(steps[i].start).toBe(steps[i - 1].end);
  expect(steps[steps.length - 2].end).toBe(result.net);
  expect(steps[steps.length - 1]).toMatchObject({ key: 'net', kind: 'total', start: 0, end: 167058.94, label: 'Estimated net proceeds' });
});

test('the ring splits the price into what the seller keeps and each group', () => {
  const result = calculateNetProceeds({ ...base, sellerResidency: 'us', principalResidence: false });
  const shares = Object.fromEntries(result.shares.map((part) => [part.key, part.value]));
  expect(shares.net).toBe(result.net);
  expect(shares.liens).toBe(250734.96);
  expect(shares.commission).toBe(24750);
  expect(shares.closing).toBe(175);
  expect(shares.credits).toBe(5000);
  expect(shares.prorations).toBe(2441.1);
  expect(shares.withholding).toBe(13500);
  // The deductions and the net add back to the price less credits.
  const sum = Math.round(result.shares.reduce((total, part) => total + part.value, 0) * 100) / 100;
  expect(sum).toBe(Math.round((result.salePrice + result.totalCredits) * 100) / 100);
});

test('a paid tax bill raises the net and steps the staircase up', () => {
  const result = calculateNetProceeds({ ...base, taxBillPaid: true });
  expect(line(result, 'propertyTax')).toMatchObject({ amount: 2958.9, kind: 'credit', label: 'Property tax refunded by the buyer' });
  expect(result.totalCredits).toBe(3118.9);
  // 450,000 + 2,958.90 + 160 − (283,101.06 − 2,441.10)
  expect(result.net).toBe(172458.94);
  const step = result.steps.find((item) => item.key === 'propertyTax');
  expect(step.end).toBeGreaterThan(step.start);
});

test('prorated taxes and other lines can be typed as amounts', () => {
  const result = calculateNetProceeds({ ...base, taxMode: 'amount', taxAmount: '1800', recordingFees: '50', otherLiens: '12000', otherCosts: '650', titleClearance: '400', mailAway: '75', homeWarranty: '600', repairCredits: '1500' });
  expect(line(result, 'propertyTax').amount).toBe(1800);
  expect(line(result, 'recordingFees').amount).toBe(50);
  expect(line(result, 'otherLiens').amount).toBe(12000);
  expect(line(result, 'otherCosts').amount).toBe(650);
  expect(line(result, 'titleClearance').amount).toBe(400);
  expect(line(result, 'mailAway').amount).toBe(75);
  expect(line(result, 'homeWarranty').amount).toBe(600);
  expect(line(result, 'repairCredits').amount).toBe(1500);
  expect(line(result, 'cancellationRecording').amount).toBe(50);
});

test('owing more than the sale brings is shown as a shortfall, not hidden', () => {
  const result = calculateNetProceeds({ ...base, payoffMode: 'letter', mortgagePayoff: '440000' });
  expect(result.net).toBe(-22206.1);
  expect(result.shortfall).toBe(true);
  expect(result.steps[result.steps.length - 1]).toMatchObject({ label: 'Shortfall at closing', end: -22206.1 });
  expect(result.notes.join(' ')).toContain('bring money to closing');
  expect(result.shares.find((part) => part.key === 'net').value).toBe(0);
});

test('no commission entered is pointed out; no closing date leaves prorations and payoff interest unestimated', () => {
  expect(calculateNetProceeds({ ...base, listingPct: '', buyerPct: '' }).notes.join(' ')).toContain('No commission is entered');
  const undated = calculateNetProceeds({ ...base, closingDate: '' });
  expect(line(undated, 'propertyTax')).toBeUndefined();
  expect(line(undated, 'hoaDues')).toBeUndefined();
  expect(line(undated, 'mortgagePayoff').amount).toBe(250050);
  const notes = undated.notes.join(' ');
  expect(notes).toContain('choose a closing date');
  expect(notes).toContain('Association dues are not prorated yet');
  expect(notes).toContain('balance alone until a closing date');
  expect(calculateNetProceeds({ ...base, mortgageRate: '' }).notes.join(' ')).toContain('payoff carries no interest');
});

test('two offers are compared on net, not price', () => {
  const { a, b, difference } = compareOffers(base, { salePrice: '442000', concessions: '0', buyerPct: '2.5', closingDate: '2026-06-30' });
  expect(a.net).toBe(167058.94);
  // $8,000 less price, $5,000 less contribution, $440 less commission, more payoff interest and tax days.
  expect(b.salePrice).toBe(442000);
  expect(line(b, 'concessions')).toBeUndefined();
  expect(b.commission.total).toBe(24310);
  expect(b.payoff.interestDays).toBe(31);
  expect(difference).toBe(Math.round((b.net - a.net) * 100) / 100);
  expect(difference).toBeLessThan(0);
  expect(difference).toBeGreaterThan(-5000);
});

test('the summary carries figures only', () => {
  const summary = summarizeNetSheet(calculateNetProceeds({ ...base, sellerResidency: 'us', principalResidence: false }));
  expect(summary).toContain('Sale price $450,000, closing 2026-06-15.');
  expect(summary).toContain('Mortgage payoff $250,735 (estimated); commission 5.5% ($24,750).');
  expect(summary).toContain('Estimated net proceeds $153,559 (34% of price).');
  expect(summary).toContain('Includes withholding of $13,500.');
  expect(summarizeNetSheet(calculateNetProceeds({}))).toBe('');
});

test('no sale price means no result, and nothing is NaN', () => {
  const result = calculateNetProceeds({});
  expect(result.valid).toBe(false);
  expect(result.net).toBe(0);
  expect(result.items).toEqual([]);
  expect(Number.isFinite(result.netPct)).toBe(true);
  expect(JSON.stringify(result)).not.toContain('NaN');
});
