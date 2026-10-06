// Seller Net Proceeds Calculator ("net sheet"): the arithmetic. It runs in the
// visitor's browser; nothing is sent anywhere. The result is an estimate from
// what the visitor types, not a settlement statement. Formulas, sources and
// defaults are written out in docs/buyer-seller-calculators.md.
import { amount } from './mortgage';

export const NET_SHEET_VERSION = 'diamond-net-sheet-1.0.0';

const cents = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

// Georgia real estate transfer tax, O.C.G.A. 48-6-1: $1.00 for the first $1,000
// or fractional part of $1,000, and 10 cents for each additional $100 or
// fractional part of $100. No tax where the value is $100 or less. The same
// rate applies in every county. The seller is liable unless the contract says
// otherwise.
export const georgiaTransferTax = (salePrice) => {
  const price = amount(salePrice);
  if (price <= 100) return 0;
  if (price <= 1000) return 1;
  return cents(1 + 0.1 * Math.ceil((price - 1000) / 100 - 1e-9));
};

const DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const isLeapYear = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

// Reads a date typed as YYYY-MM-DD without building a Date, so the answer does
// not depend on the visitor's time zone.
export const parseClosingDate = (text) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text ?? '').trim());
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || year < 1900) return null;
  const monthLength = month === 2 ? (isLeapYear(year) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  if (day < 1 || day > monthLength) return null;
  const daysInYear = isLeapYear(year) ? 366 : 365;
  const dayOfYear = DAYS_BEFORE_MONTH[month - 1] + day + (month > 2 && isLeapYear(year) ? 1 : 0);
  return { year, month, day, dayOfYear, daysInYear };
};

// Georgia counties tax by the calendar year and bill in the autumn. The seller
// owns the home from January 1 to the day before closing. If the year's bill is
// not yet paid, the seller gives the buyer that share; if the seller has paid
// it, the buyer gives the seller the rest of the year back.
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

export const calculateNetProceeds = (input = {}) => {
  const salePrice = cents(amount(input.salePrice));
  const share = (percent) => cents((salePrice * Math.min(amount(percent), 100)) / 100);

  const listingCommission = share(input.listingPct);
  const buyerCommission = share(input.buyerPct);
  const closingCosts = input.closingMode === 'amount' ? cents(amount(input.closingCosts)) : share(input.closingCosts);
  const transferTax = input.transferTaxMode === 'amount' ? cents(amount(input.transferTax)) : georgiaTransferTax(salePrice);
  const proration = input.taxMode === 'amount'
    ? { estimated: false, amount: cents(amount(input.taxAmount)), kind: 'deduction' }
    : prorateAnnualTax({ annualTax: input.annualTax, closingDate: input.closingDate, billPaid: Boolean(input.taxBillPaid) });

  const lines = [
    { key: 'mortgagePayoff', label: 'Mortgage payoff', group: 'Loans and liens', amount: cents(amount(input.mortgagePayoff)), kind: 'deduction' },
    { key: 'otherLiens', label: 'Other liens', group: 'Loans and liens', amount: cents(amount(input.otherLiens)), kind: 'deduction' },
    { key: 'listingCommission', label: 'Listing brokerage commission', group: 'Commission', amount: listingCommission, kind: 'deduction' },
    { key: 'buyerCommission', label: 'Buyer brokerage compensation', group: 'Commission', amount: buyerCommission, kind: 'deduction' },
    { key: 'closingCosts', label: 'Closing costs, title and attorney fees', group: 'Closing', amount: closingCosts, kind: 'deduction' },
    { key: 'transferTax', label: input.transferTaxMode === 'amount' ? 'Transfer tax' : 'Georgia transfer tax', group: 'Closing', amount: transferTax, kind: 'deduction' },
    { key: 'recordingFees', label: 'Recording and government fees', group: 'Closing', amount: cents(amount(input.recordingFees)), kind: 'deduction' },
    { key: 'concessions', label: 'Seller concessions and repair credits', group: 'Credits to the buyer', amount: cents(amount(input.concessions)), kind: 'deduction' },
    { key: 'propertyTax', label: proration.kind === 'credit' ? 'Property tax refunded by the buyer' : 'Prorated property taxes', group: 'Prorations', amount: proration.amount, kind: proration.kind },
    { key: 'hoaDues', label: 'Outstanding HOA dues', group: 'Prorations', amount: cents(amount(input.hoaDues)), kind: 'deduction' },
    { key: 'otherCosts', label: 'Other costs', group: 'Other', amount: cents(amount(input.otherCosts)), kind: 'deduction' },
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

  const commissionTotal = cents(listingCommission + buyerCommission);
  const notes = [];
  if (salePrice > 0 && net < 0) notes.push('The costs entered are more than the sale price. On these figures you would need to bring money to closing, or agree a short sale with your lender.');
  if (salePrice > 0 && commissionTotal === 0) notes.push('No commission is entered. If you have a listing agreement, enter the rates it states.');
  if (input.taxMode !== 'amount' && amount(input.annualTax) > 0 && !proration.estimated) notes.push('Property taxes are not prorated yet: choose a closing date to estimate them.');

  return {
    version: NET_SHEET_VERSION,
    valid: salePrice > 0,
    salePrice,
    items,
    totalDeductions,
    totalCredits,
    net,
    netPct: salePrice > 0 ? (net / salePrice) * 100 : 0,
    shortfall: net < 0,
    commission: { listing: listingCommission, buyer: buyerCommission, total: commissionTotal, totalPct: Math.min(amount(input.listingPct), 100) + Math.min(amount(input.buyerPct), 100) },
    transferTax,
    proration,
    steps,
    notes,
  };
};
