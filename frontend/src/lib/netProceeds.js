// Seller Net Proceeds Calculator ("net sheet"): the arithmetic. It runs in the
// visitor's browser; nothing is sent anywhere. The result is an estimate from
// what the visitor types, not a settlement statement. Formulas, sources and
// defaults are written out in docs/buyer-seller-calculators.md (version 1) and
// docs/seller-net-sheet-v2.md (this version).
import { amount } from './mortgage';

export const NET_SHEET_VERSION = 'diamond-net-sheet-2.0.0';

const cents = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const flag = (value, fallback) => (value === undefined || value === null || value === '' ? fallback : value === true || value === 'true' || value === 'yes' || value === 'on');

// Georgia real estate transfer tax, O.C.G.A. 48-6-1: $1.00 for the first $1,000
// or fractional part of $1,000, and 10 cents for each additional $100 or
// fractional part of $100. No tax where the value is $100 or less. The same
// rate applies in every county. The seller is liable by statute, but the GAR
// purchase and sale agreement puts it on the buyer by default ("Items Paid by
// Buyer"), so the sheet asks who pays.
export const georgiaTransferTax = (salePrice) => {
  const price = amount(salePrice);
  if (price <= 100) return 0;
  if (price <= 1000) return 1;
  return cents(1 + 0.1 * Math.ceil((price - 1000) / 100 - 1e-9));
};

// Recording, O.C.G.A. 15-6-77(f) (HB 288, from 2020-01-01): a flat fee per
// instrument. The seller records a cancellation for each lien paid off.
export const RECORDING_FEE = 25;

// Georgia withholding on a nonresident seller, O.C.G.A. 48-7-128 and Ga. Comp.
// R. & Regs. 560-7-8-.35: 3% of the price, or of the gain with a sworn gain
// affidavit (IT-AFF2). None if the price is under $20,000, if the home was the
// seller's principal residence, or if the tax on the gain would be under $600.
export const GA_WITHHOLDING_PCT = 3;
export const GA_WITHHOLDING_MIN_PRICE = 20000;
export const GA_WITHHOLDING_MIN_TAX = 600;

// Federal FIRPTA, IRC 1445, on a foreign-person seller: 15% of the amount
// realized; 10% when the price is over $300,000 and up to $1,000,000 and the
// buyer will live in the home; nothing at $300,000 or less with a buyer who
// will live in it. The seller's own use of the home does not matter here.
export const firptaPct = (price, buyerWillOccupy) => {
  if (price <= 0) return 0;
  if (buyerWillOccupy && price <= 300000) return 0;
  if (buyerWillOccupy && price <= 1000000) return 10;
  return 15;
};

export const RESIDENCY = [
  { key: 'georgia', label: 'Georgia resident' },
  { key: 'us', label: 'US resident, outside Georgia' },
  { key: 'foreign', label: 'Not a US resident' },
];

export const HOA_PERIODS = [
  { key: 'month', label: 'a month' },
  { key: 'quarter', label: 'a quarter' },
  { key: 'year', label: 'a year' },
];

const DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const isLeapYear = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
const monthLength = (year, month) => (month === 2 ? (isLeapYear(year) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31);

// Reads a date typed as YYYY-MM-DD without building a Date, so the answer does
// not depend on the visitor's time zone.
export const parseClosingDate = (text) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text ?? '').trim());
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || year < 1900) return null;
  if (day < 1 || day > monthLength(year, month)) return null;
  const daysInYear = isLeapYear(year) ? 366 : 365;
  const dayOfYear = DAYS_BEFORE_MONTH[month - 1] + day + (month > 2 && isLeapYear(year) ? 1 : 0);
  return { year, month, day, dayOfYear, daysInYear };
};

// Days from one date to another, counting the first and not the second.
const dayNumber = (date) => {
  // Days since 1900-01-01, enough for subtraction.
  let days = 0;
  for (let year = 1900; year < date.year; year += 1) days += isLeapYear(year) ? 366 : 365;
  return days + date.dayOfYear;
};
export const daysBetween = (from, to) => (from && to ? dayNumber(to) - dayNumber(from) : 0);

// Georgia counties tax by the calendar year and bill in the autumn. The seller
// owns the home from January 1 to the day before closing. If the year's bill is
// not yet paid, the seller gives the buyer that share; if the seller has paid
// it, the buyer gives the seller the rest of the year back. Before the bill is
// issued the prior year's bill stands in, and the GAR contract (2025 F201
// B.3(d)) has the party who underpaid make it up once the bill comes.
export const prorateAnnualTax = ({ annualTax, closingDate, billPaid }) => {
  const tax = amount(annualTax);
  const date = parseClosingDate(closingDate);
  if (!date || tax === 0) return { estimated: false, amount: 0, kind: 'deduction', sellerDays: 0, daysInYear: date ? date.daysInYear : 365 };
  const sellerDays = date.dayOfYear - 1;
  const sellerShare = cents((tax * sellerDays) / date.daysInYear);
  return billPaid
    ? { estimated: true, amount: cents(tax - sellerShare), kind: 'credit', sellerDays, daysInYear: date.daysInYear }
    : { estimated: true, amount: sellerShare, kind: 'deduction', sellerDays, daysInYear: date.daysInYear };
};

// Association dues are prorated over the period they cover (a month, a quarter
// or a year that contains the closing). Paid ahead: the buyer returns the rest
// of the period. Not yet paid: the seller owes the days up to closing.
export const prorateDues = ({ dues, period, closingDate, paid }) => {
  const due = amount(dues);
  const date = parseClosingDate(closingDate);
  if (!date || due === 0) return { estimated: false, amount: 0, kind: 'deduction', sellerDays: 0, periodDays: 0 };
  let periodDays;
  let sellerDays;
  if (period === 'year') { periodDays = date.daysInYear; sellerDays = date.dayOfYear - 1; } else if (period === 'quarter') {
    const firstMonth = Math.floor((date.month - 1) / 3) * 3 + 1;
    periodDays = [0, 1, 2].reduce((sum, offset) => sum + monthLength(date.year, firstMonth + offset), 0);
    sellerDays = [0, 1, 2].filter((offset) => firstMonth + offset < date.month).reduce((sum, offset) => sum + monthLength(date.year, firstMonth + offset), 0) + date.day - 1;
  } else { periodDays = monthLength(date.year, date.month); sellerDays = date.day - 1; }
  const sellerShare = cents((due * sellerDays) / periodDays);
  return paid
    ? { estimated: true, amount: cents(due - sellerShare), kind: 'credit', sellerDays, periodDays }
    : { estimated: true, amount: sellerShare, kind: 'deduction', sellerDays, periodDays };
};

// A lender's payoff is the balance plus interest, which is paid in arrears:
// from the day the last payment covered through the day the lender receives
// the wire, which the attorney pads by a day or two. The release fee and the
// recording of the cancellation are added. The escrow balance is not netted;
// the servicer refunds it after closing.
export const estimatePayoff = ({ balance, ratePct, paidThrough, closingDate, cushionDays, releaseFee }) => {
  const principal = cents(amount(balance));
  const rate = Math.min(amount(ratePct), 30);
  const closing = parseClosingDate(closingDate);
  const through = parseClosingDate(paidThrough);
  const cushion = Math.min(10, Math.round(amount(cushionDays ?? 2)));
  const perDiem = cents((principal * rate) / 100 / 365);
  // With no paid-through date, interest is assumed paid through the first of
  // the closing month: the usual case when the seller made that month's payment.
  const from = through || (closing ? { ...closing, day: 1, dayOfYear: closing.dayOfYear - closing.day + 1 } : null);
  const interestDays = closing && from ? Math.max(0, daysBetween(from, closing) + cushion) : 0;
  const interest = cents(perDiem * interestDays);
  const release = cents(amount(releaseFee));
  return { estimated: Boolean(closing && principal > 0), principal, perDiem, interestDays, cushionDays: cushion, interest, releaseFee: release, total: cents(principal + interest + release) };
};

export const calculateNetProceeds = (input = {}) => {
  const salePrice = cents(amount(input.salePrice));
  const share = (percent) => cents((salePrice * Math.min(amount(percent), 100)) / 100);
  const closingDate = input.closingDate;
  const closing = parseClosingDate(closingDate);

  // Loans and liens. The first mortgage is either an estimated payoff from the
  // balance, rate and dates, or the figure from the lender's letter. Older
  // inputs named the typed figure `mortgagePayoff`; it still works.
  const payoffMode = input.payoffMode || (input.mortgageBalance !== undefined ? 'estimate' : 'letter');
  const payoffEstimate = estimatePayoff({ balance: input.mortgageBalance ?? input.mortgagePayoff, ratePct: input.mortgageRate, paidThrough: input.paidThrough, closingDate, cushionDays: input.payoffCushionDays, releaseFee: input.payoffReleaseFee });
  const mortgagePayoff = payoffMode === 'estimate' ? payoffEstimate.total : cents(amount(input.mortgagePayoff ?? input.mortgageBalance));
  const secondLien = cents(amount(input.secondLien));
  const otherLiens = cents(amount(input.otherLiens));
  const liensPaid = [mortgagePayoff, secondLien, otherLiens].filter((value) => value > 0).length;

  // Commission.
  const listingCommission = share(input.listingPct);
  const buyerCommission = share(input.buyerPct);

  // Allocation. Transfer tax and deed preparation go to the buyer under the
  // GAR form unless the contract moves them.
  const transferTaxPayer = input.transferTaxPayer === 'seller' ? 'seller' : 'buyer';
  const transferTaxFigure = input.transferTaxMode === 'amount' ? cents(amount(input.transferTax)) : georgiaTransferTax(salePrice);
  const transferTax = transferTaxPayer === 'seller' ? transferTaxFigure : 0;
  const deedPrep = transferTaxPayer === 'seller' ? cents(amount(input.deedPrep)) : 0;

  // The seller's own flat closing costs.
  const payoffProcessing = cents(amount(input.payoffProcessing));
  const cancellationRecording = cents(liensPaid * RECORDING_FEE);
  const titleClearance = cents(amount(input.titleClearance));
  const mailAway = cents(amount(input.mailAway));
  const homeWarranty = cents(amount(input.homeWarranty));
  const otherCosts = cents(amount(input.otherCosts));
  // Version 1 had one "closing costs" figure; keep reading it when given.
  const legacyClosing = input.closingCosts !== undefined && input.closingCosts !== '' ? (input.closingMode === 'amount' ? cents(amount(input.closingCosts)) : share(input.closingCosts)) : 0;

  // Credits to the buyer.
  const concessions = cents(amount(input.concessions));
  const repairCredits = cents(amount(input.repairCredits));

  // Prorations.
  const taxProration = input.taxMode === 'amount'
    ? { estimated: false, amount: cents(amount(input.taxAmount)), kind: 'deduction' }
    : prorateAnnualTax({ annualTax: input.annualTax, closingDate, billPaid: flag(input.taxBillPaid, false) });
  const duesProration = prorateDues({ dues: input.hoaDues, period: input.hoaPeriod || 'month', closingDate, paid: flag(input.hoaPaid, true) });
  const hoaPastDue = cents(amount(input.hoaPastDue));
  const hoaLetterFee = input.hoaLetterPayer === 'buyer' ? 0 : cents(amount(input.hoaLetterFee));
  const hoaTransferFee = input.hoaTransferPayer === 'seller' ? cents(amount(input.hoaTransferFee)) : 0;

  // Withholding.
  const residency = RESIDENCY.some((item) => item.key === input.sellerResidency) ? input.sellerResidency : 'georgia';
  const principalResidence = flag(input.principalResidence, true);
  const buyerWillOccupy = flag(input.buyerWillOccupy, true);
  const gain = cents(amount(input.gainAmount));
  const gaBase = input.gaWithholdingMode === 'gain' ? gain : salePrice;
  let gaWithholding = 0;
  let gaWithholdingNote = null;
  if (salePrice > 0 && residency !== 'georgia') {
    if (principalResidence) gaWithholdingNote = 'exempt: principal residence';
    else if (salePrice < GA_WITHHOLDING_MIN_PRICE) gaWithholdingNote = 'exempt: price under $20,000';
    else {
      const tax = cents((gaBase * GA_WITHHOLDING_PCT) / 100);
      if (input.gaWithholdingMode === 'gain' && tax < GA_WITHHOLDING_MIN_TAX) gaWithholdingNote = 'none: tax on the gain is under $600';
      else gaWithholding = tax;
    }
  }
  const firptaRate = residency === 'foreign' && salePrice > 0 ? firptaPct(salePrice, buyerWillOccupy) : 0;
  const firpta = cents((salePrice * firptaRate) / 100);

  const lines = [
    { key: 'mortgagePayoff', label: payoffMode === 'estimate' ? 'Mortgage payoff (estimated)' : 'Mortgage payoff', group: 'Loans and liens', amount: mortgagePayoff, kind: 'deduction' },
    { key: 'secondLien', label: 'Second mortgage or HELOC payoff', group: 'Loans and liens', amount: secondLien, kind: 'deduction' },
    { key: 'otherLiens', label: 'Other liens', group: 'Loans and liens', amount: otherLiens, kind: 'deduction' },
    { key: 'listingCommission', label: 'Listing brokerage commission', group: 'Commission', amount: listingCommission, kind: 'deduction' },
    { key: 'buyerCommission', label: 'Buyer brokerage compensation', group: 'Commission', amount: buyerCommission, kind: 'deduction' },
    { key: 'closingCosts', label: 'Closing costs, title and attorney fees', group: 'Closing', amount: legacyClosing, kind: 'deduction' },
    { key: 'transferTax', label: input.transferTaxMode === 'amount' ? 'Transfer tax' : 'Georgia transfer tax', group: 'Closing', amount: transferTax, kind: 'deduction' },
    { key: 'deedPrep', label: 'Deed preparation', group: 'Closing', amount: deedPrep, kind: 'deduction' },
    { key: 'payoffProcessing', label: 'Payoff processing, wire and courier', group: 'Closing', amount: payoffProcessing, kind: 'deduction' },
    { key: 'cancellationRecording', label: `Recording ${liensPaid === 1 ? 'the lien cancellation' : `${liensPaid} lien cancellations`}`, group: 'Closing', amount: cancellationRecording, kind: 'deduction' },
    { key: 'titleClearance', label: 'Clearing title', group: 'Closing', amount: titleClearance, kind: 'deduction' },
    { key: 'mailAway', label: 'Mail-away or power of attorney', group: 'Closing', amount: mailAway, kind: 'deduction' },
    { key: 'homeWarranty', label: 'Home warranty', group: 'Closing', amount: homeWarranty, kind: 'deduction' },
    { key: 'recordingFees', label: 'Recording and government fees', group: 'Closing', amount: cents(amount(input.recordingFees)), kind: 'deduction' },
    { key: 'otherCosts', label: 'Other costs', group: 'Closing', amount: otherCosts, kind: 'deduction' },
    { key: 'concessions', label: "Contribution to the buyer's closing costs", group: 'Credits to the buyer', amount: concessions, kind: 'deduction' },
    { key: 'repairCredits', label: 'Repair credits', group: 'Credits to the buyer', amount: repairCredits, kind: 'deduction' },
    { key: 'propertyTax', label: taxProration.kind === 'credit' ? 'Property tax refunded by the buyer' : 'Prorated property taxes', group: 'Prorations', amount: taxProration.amount, kind: taxProration.kind },
    { key: 'hoaDues', label: duesProration.kind === 'credit' ? 'Association dues refunded by the buyer' : 'Prorated association dues', group: 'Prorations', amount: duesProration.amount, kind: duesProration.kind },
    { key: 'hoaPastDue', label: 'Unpaid association dues and assessments', group: 'Prorations', amount: hoaPastDue, kind: 'deduction' },
    { key: 'hoaLetterFee', label: 'Association closing letter', group: 'Prorations', amount: hoaLetterFee, kind: 'deduction' },
    { key: 'hoaTransferFee', label: 'Association transfer fee', group: 'Prorations', amount: hoaTransferFee, kind: 'deduction' },
    { key: 'gaWithholding', label: `Georgia nonresident withholding (3% of ${input.gaWithholdingMode === 'gain' ? 'gain' : 'price'})`, group: 'Withholding', amount: gaWithholding, kind: 'deduction' },
    { key: 'firpta', label: `FIRPTA federal withholding (${firptaRate}%)`, group: 'Withholding', amount: firpta, kind: 'deduction' },
  ];
  const items = lines.filter((line) => line.amount > 0);

  const totalDeductions = cents(items.filter((item) => item.kind === 'deduction').reduce((total, item) => total + item.amount, 0));
  const totalCredits = cents(items.filter((item) => item.kind === 'credit').reduce((total, item) => total + item.amount, 0));
  const net = cents(salePrice + totalCredits - totalDeductions);

  // The same story as a staircase: start at the sale price, step down by each
  // deduction (up by a credit), and land on the net.
  const steps = [{ key: 'salePrice', label: 'Sale price', kind: 'total', start: 0, end: salePrice, amount: salePrice }];
  let running = salePrice;
  items.forEach((item) => {
    const next = cents(item.kind === 'credit' ? running + item.amount : running - item.amount);
    steps.push({ key: item.key, label: item.label, kind: item.kind, start: running, end: next, amount: item.amount });
    running = next;
  });
  steps.push({ key: 'net', label: net < 0 ? 'Shortfall at closing' : 'Estimated net proceeds', kind: 'total', start: 0, end: net, amount: net });

  // Where the sale price goes, by group, for the ring chart. Credits are
  // already inside the net, so the ring shows the price split into what the
  // seller keeps and each group of deductions.
  const groupTotal = (group) => cents(items.filter((item) => item.kind === 'deduction' && item.group === group).reduce((sum, item) => sum + item.amount, 0));
  const shares = [
    { key: 'net', label: 'You keep (net proceeds)', value: Math.max(0, net) },
    { key: 'liens', label: 'Loans and liens', value: groupTotal('Loans and liens') },
    { key: 'commission', label: 'Commission', value: groupTotal('Commission') },
    { key: 'closing', label: 'Closing costs', value: groupTotal('Closing') },
    { key: 'credits', label: 'Credits to the buyer', value: groupTotal('Credits to the buyer') },
    { key: 'prorations', label: 'Prorations and association', value: groupTotal('Prorations') },
    { key: 'withholding', label: 'Withholding', value: groupTotal('Withholding') },
  ];

  const commissionTotal = cents(listingCommission + buyerCommission);
  const notes = [];
  if (salePrice > 0 && net < 0) notes.push('The costs entered are more than the sale price. On these figures you would need to bring money to closing, or agree a short sale with your lender.');
  if (salePrice > 0 && commissionTotal === 0) notes.push('No commission is entered. If you have a listing agreement, enter the rates it states.');
  if (input.taxMode !== 'amount' && amount(input.annualTax) > 0 && !taxProration.estimated) notes.push('Property taxes are not prorated yet: choose a closing date to estimate them.');
  if (amount(input.hoaDues) > 0 && !duesProration.estimated) notes.push('Association dues are not prorated yet: choose a closing date.');
  if (payoffMode === 'estimate' && amount(input.mortgageBalance ?? input.mortgagePayoff) > 0 && !closing) notes.push('The payoff is the balance alone until a closing date sets the interest owed.');
  if (payoffMode === 'estimate' && payoffEstimate.estimated && amount(input.mortgageRate) === 0) notes.push('No interest rate is entered for the mortgage, so the payoff carries no interest. A payoff always includes interest to the day the lender is paid.');
  if (gaWithholding > 0) notes.push(`Georgia withholds ${GA_WITHHOLDING_PCT}% from a nonresident seller at closing (O.C.G.A. 48-7-128). It is a prepayment, recovered on your Georgia return; a sworn gain affidavit (IT-AFF2) can base it on the gain instead. The closing attorney handles the forms.`);
  if (gaWithholdingNote) notes.push(`Georgia nonresident withholding: ${gaWithholdingNote}. Confirm with the closing attorney, who files the affidavit.`);
  if (firpta > 0) notes.push(`FIRPTA: a buyer must withhold ${firptaRate}% from a seller who is not a US resident (IRC 1445), remitted to the IRS and credited on your US return. A withholding certificate can reduce it; ask a CPA before listing.`);
  if (residency === 'foreign' && firpta === 0 && salePrice > 0) notes.push('FIRPTA: no withholding because the price is $300,000 or less and the buyer will live in the home. If the buyer will not, 15% applies.');
  if (transferTaxPayer === 'buyer' && salePrice > 0) notes.push('Georgia transfer tax and deed preparation are shown as the buyer\'s, the GAR contract default. If your contract puts them on you, switch the toggle.');

  return {
    version: NET_SHEET_VERSION,
    valid: salePrice > 0,
    salePrice,
    closingDate: closing,
    items,
    totalDeductions,
    totalCredits,
    net,
    netPct: salePrice > 0 ? (net / salePrice) * 100 : 0,
    shortfall: net < 0,
    commission: { listing: listingCommission, buyer: buyerCommission, total: commissionTotal, totalPct: Math.min(amount(input.listingPct), 100) + Math.min(amount(input.buyerPct), 100) },
    transferTax: transferTaxFigure,
    transferTaxPayer,
    payoff: { mode: payoffMode, ...payoffEstimate, total: mortgagePayoff },
    proration: taxProration,
    dues: duesProration,
    withholding: { residency, principalResidence, ga: gaWithholding, gaNote: gaWithholdingNote, firpta, firptaRate, buyerWillOccupy },
    shares,
    steps,
    notes,
  };
};

// Two offers side by side: the same seller, the same costs, different price,
// contribution, buyer-broker compensation and closing date.
export const compareOffers = (input, offer) => {
  const a = calculateNetProceeds(input);
  const b = calculateNetProceeds({
    ...input,
    salePrice: offer.salePrice ?? input.salePrice,
    concessions: offer.concessions ?? input.concessions,
    repairCredits: offer.repairCredits ?? input.repairCredits,
    buyerPct: offer.buyerPct ?? input.buyerPct,
    closingDate: offer.closingDate || input.closingDate,
    buyerWillOccupy: offer.buyerWillOccupy ?? input.buyerWillOccupy,
  });
  return { a, b, difference: cents(b.net - a.net) };
};

// A short plain-text summary of the estimate for the visitor to print or, if
// they choose, to paste into a request. Figures only, never a name.
export const summarizeNetSheet = (result) => {
  if (!result.valid) return '';
  const usd = (value) => `$${Math.round(Math.abs(value)).toLocaleString('en-US')}`;
  const parts = [
    `Sale price ${usd(result.salePrice)}${result.closingDate ? `, closing ${result.closingDate.year}-${String(result.closingDate.month).padStart(2, '0')}-${String(result.closingDate.day).padStart(2, '0')}` : ''}.`,
    `Mortgage payoff ${usd(result.payoff.total)}${result.payoff.mode === 'estimate' ? ' (estimated)' : ''}; commission ${result.commission.totalPct}% (${usd(result.commission.total)}).`,
    `Total deductions ${usd(result.totalDeductions)}${result.totalCredits > 0 ? `, credits ${usd(result.totalCredits)}` : ''}.`,
    result.shortfall ? `Estimated shortfall at closing ${usd(result.net)}.` : `Estimated net proceeds ${usd(result.net)} (${Math.round(result.netPct)}% of price).`,
  ];
  if (result.withholding.ga > 0 || result.withholding.firpta > 0) parts.push(`Includes withholding of ${usd(result.withholding.ga + result.withholding.firpta)}.`);
  return parts.join(' ');
};
