// What the page makes of a listing's history and a seller's posture, and the
// sanity checks on a fix-and-flip's figures (items 2, 7 and 8 of the
// 2026-10-22 review of the Fix & flip tab). Nothing here is looked up: every
// fact is typed in, or loaded for an address where a public-record provider
// is configured. The page says what the facts usually mean; the visitor
// decides what they mean here.

const n = (value) => Number(value || 0);
export const usd = (value) => Math.round(value).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const pct = (value) => `${Math.round(value * 100)}%`;

export const OWNER_TYPES = [
  { value: '', label: 'Not known' },
  { value: 'owner_occupant', label: 'Owner-occupant' },
  { value: 'investor', label: 'Investor or flipper' },
  { value: 'agent', label: 'Licensed agent (agent-owned)' },
  { value: 'builder', label: 'Builder or developer' },
  { value: 'estate_or_bank', label: 'Estate, bank or relocation company' },
];
export const DISCLOSURE_STATUSES = [
  { value: '', label: 'Not known' },
  { value: 'provided', label: 'Disclosure provided' },
  { value: 'none', label: 'No disclosure (exempt or refused)' },
];
export const SALE_TERMS = [
  { value: '', label: 'Not known' },
  { value: 'standard', label: 'Standard (repairs negotiable)' },
  { value: 'as_is', label: 'As-is' },
];
const ownerLabel = (value) => ({ owner_occupant: 'an owner-occupant', investor: 'an investor', agent: 'a licensed agent selling their own property', builder: 'a builder', estate_or_bank: 'an estate, bank or relocation company' })[value] || null;

// Whole months from a typed month ("2025-04") or date ("2025-04-18") to now.
export const monthsSince = (text, now = new Date()) => {
  const match = /^(\d{4})-(\d{1,2})/.exec(String(text || '').trim());
  if (!match) return null;
  const year = Number(match[1]); const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const months = (now.getFullYear() - year) * 12 + (now.getMonth() + 1 - month);
  return months < 0 ? null : months;
};

// Thresholds, named so the doc and the tests can cite them.
export const LISTING_THRESHOLDS = Object.freeze({
  shortHoldMonths: 36,      // a resale within this is "a short hold"
  bigCutRate: 0.10,         // a cut of this much or more from the original list price
  quickMarkupRate: 0.20,    // asking this much more than paid within two years
  quickMarkupMonths: 24,
  longOnMarketDays: 90,     // a thin buyer pool
  slowOnMarketDays: 60,
  asIsContingencyRate: 0.15, // the least contingency usual for an as-is sale
});

// Facts and signals from the listing history and seller fields of the form.
// A signal is { level: 'caution' | 'note', text }. Cautions become exceptions
// in the decision; notes are shown beside the facts.
export const buildListingSignals = (form, { now = new Date() } = {}) => {
  const price = n(form.purchasePrice);
  const lastSalePrice = n(form.lastSalePrice);
  const months = monthsSince(form.lastSaleDate, now);
  const originalListPrice = n(form.originalListPrice);
  const daysOnMarket = Math.round(n(form.daysOnMarket));
  const contingency = n(form.rehabContingency) / 100;
  const t = LISTING_THRESHOLDS;
  const facts = [];
  const signals = [];
  const when = months === null ? '' : months === 0 ? ' this month' : months === 1 ? ' a month ago' : ` ${months} months ago`;

  if (lastSalePrice > 0) {
    const gap = price - lastSalePrice;
    facts.push({ key: 'lastSale', label: 'Last sale', value: usd(lastSalePrice), detail: months === null ? 'date not entered' : when.trim() });
    if (price > 0 && gap < 0) {
      const shortHold = months !== null && months <= t.shortHoldMonths;
      signals.push({ level: 'caution', text: `The seller paid ${usd(lastSalePrice)}${when} and is asking ${usd(-gap)} (${pct(-gap / lastSalePrice)}) less. Selling below their own basis${shortHold ? ' after a short hold' : ''} usually means a failed project or a problem found; find out which before relying on the budget.` });
    } else if (price > 0 && months !== null && months <= t.quickMarkupMonths && gap >= lastSalePrice * t.quickMarkupRate) {
      signals.push({ level: 'note', text: `The seller paid ${usd(lastSalePrice)}${when} and asks ${pct(gap / lastSalePrice)} more. Check what work was done for that, and whether it was permitted.` });
    }
  }

  if (originalListPrice > 0 && price > 0) {
    const cut = originalListPrice - price;
    facts.push({ key: 'listPrice', label: 'Original list price', value: usd(originalListPrice), detail: cut > 0 ? `cut ${pct(cut / originalListPrice)} to ${usd(price)}` : cut < 0 ? `raised to ${usd(price)}` : 'unchanged' });
    if (cut > 0) {
      const over = daysOnMarket > 0 ? ` over ${daysOnMarket} days on market` : '';
      signals.push(cut >= originalListPrice * t.bigCutRate
        ? { level: 'caution', text: `Listed at ${usd(originalListPrice)} and cut ${pct(cut / originalListPrice)} to ${usd(price)}${over}. The market has already passed at higher prices: verify the after-repair value against sold prices, not asking prices.` }
        : { level: 'note', text: `Listed at ${usd(originalListPrice)} and cut ${pct(cut / originalListPrice)}${over}.` });
    }
  }

  if (daysOnMarket > 0) {
    facts.push({ key: 'daysOnMarket', label: 'Days on market', value: `${daysOnMarket} days`, detail: daysOnMarket >= t.longOnMarketDays ? 'long for a house priced to sell' : daysOnMarket >= t.slowOnMarketDays ? 'slower than a quick sale' : 'recent' });
    if (daysOnMarket >= t.longOnMarketDays) signals.push({ level: 'caution', text: `${daysOnMarket} days on market at this price points to a thin buyer pool. The resale may take longer too: stress the hold period.` });
    else if (daysOnMarket >= t.slowOnMarketDays) signals.push({ level: 'note', text: `${daysOnMarket} days on market: not a quick sale. Allow for a slower resale.` });
  }

  const owner = ownerLabel(form.ownerType);
  const noDisclosure = form.disclosureStatus === 'none';
  const professional = ['investor', 'agent', 'builder'].includes(form.ownerType);
  if (owner || form.disclosureStatus || form.saleTerms) {
    const parts = [owner ? `Sold by ${owner}` : 'Seller not known'];
    if (form.disclosureStatus === 'provided') parts.push('disclosure provided');
    if (noDisclosure) parts.push('no disclosure');
    if (form.saleTerms === 'as_is') parts.push('as-is');
    if (form.saleTerms === 'standard') parts.push('repairs negotiable');
    facts.push({ key: 'seller', label: 'Seller', value: parts[0], detail: parts.slice(1).join(', ') });
  }
  if (professional && noDisclosure) signals.push({ level: 'caution', text: `The seller is ${owner} and gives no disclosure: assume they know something you do not. Order the inspections, and septic and well tests where they apply, before the diligence period ends.` });
  else if (noDisclosure) signals.push({ level: 'caution', text: 'No seller disclosure: the inspections are the only account of the house you will get. Order them before the diligence period ends.' });
  else if (professional) signals.push({ level: 'note', text: `The seller is ${owner}: expect a priced, professional negotiation and little room on repairs.` });
  if (form.ownerType === 'estate_or_bank') signals.push({ level: 'note', text: 'Estate, bank or relocation sale: expect no disclosure, a slow and by-the-book negotiation, and an as-is contract.' });
  if (form.saleTerms === 'as_is') {
    signals.push(contingency < t.asIsContingencyRate
      ? { level: 'caution', text: `Sold as-is with a ${Math.round(contingency * 100)}% rehab contingency. 15% to 20% is usual when the seller will not negotiate repairs; the contingency is the only repair credit you will get.` }
      : { level: 'note', text: `Sold as-is: the ${Math.round(contingency * 100)}% contingency is the only repair credit you will get.` });
  }

  return { facts, signals, cautions: signals.filter((signal) => signal.level === 'caution').map((signal) => signal.text) };
};

// Item 7: the monthly holding cost from its parts, and rough starting points
// for the two that can be estimated from the size of the house. Taxes are a
// public figure and are never estimated.
export const HOLDING_COST_ESTIMATES = Object.freeze({
  insurancePerSfPerYear: 0.75,  // vacant-dwelling or builder's-risk cover, rough
  utilitiesPerSfPerMonth: 0.10, // power, water and heat for a house under renovation, rough
});
export const estimateHoldingCosts = (squareFeet) => {
  const sf = n(squareFeet);
  if (!(sf > 0)) return null;
  return {
    flipAnnualInsurance: String(Math.round(sf * HOLDING_COST_ESTIMATES.insurancePerSfPerYear)),
    flipMonthlyUtilities: String(Math.round(sf * HOLDING_COST_ESTIMATES.utilitiesPerSfPerMonth)),
  };
};
export const holdingCostParts = (form) => {
  const taxes = n(form.flipAnnualTaxes) / 12;
  const insurance = n(form.flipAnnualInsurance) / 12;
  const utilities = n(form.flipMonthlyUtilities);
  const entered = [form.flipAnnualTaxes, form.flipAnnualInsurance, form.flipMonthlyUtilities].some((value) => value !== '' && value != null && Number.isFinite(Number(value)));
  return { taxes, insurance, utilities, total: Math.round(taxes + insurance + utilities), entered };
};

// Item 8: the after-repair value per square foot against the entered size and,
// when given, against renovated comparable sales per square foot.
export const ARV_COMP_TOLERANCE = 0.10;
export const arvChecks = (form) => {
  const sf = n(form.rentableSquareFeet);
  const arv = n(form.arv);
  const price = n(form.purchasePrice);
  const compPerSf = n(form.compSoldPerSf);
  const facts = [];
  const signals = [];
  if (!(sf > 0)) {
    signals.push({ level: 'note', text: 'Enter the square feet to check the after-repair value per square foot.' });
    return { facts, signals, cautions: [] };
  }
  const arvPerSf = arv / sf;
  facts.push({ key: 'arvPerSf', label: 'After-repair value per square foot', value: `${usd(arvPerSf)}/sf`, detail: `${usd(arv)} on ${Math.round(sf).toLocaleString('en-US')} sf` });
  if (price > 0) facts.push({ key: 'pricePerSf', label: 'Purchase price per square foot', value: `${usd(price / sf)}/sf`, detail: `${usd(price)} on ${Math.round(sf).toLocaleString('en-US')} sf` });
  if (compPerSf > 0) {
    const implied = compPerSf * sf;
    facts.push({ key: 'compArv', label: 'Renovated comparable sales', value: `${usd(compPerSf)}/sf`, detail: `imply ${usd(implied)} for this size` });
    if (arv > implied * (1 + ARV_COMP_TOLERANCE)) signals.push({ level: 'caution', text: `The after-repair value is ${usd(arvPerSf)}/sf, ${pct(arv / implied - 1)} above the ${usd(compPerSf)}/sf of the renovated comparable sales entered, which imply ${usd(implied)}. Use sold prices of the same kind of house, size, age and setting; a different kind of property does not price this one.` });
    else if (arv < implied * (1 - ARV_COMP_TOLERANCE)) signals.push({ level: 'note', text: `The after-repair value is ${pct(1 - arv / implied)} below what the comparable sales imply (${usd(implied)}); there may be room, or a reason.` });
    else signals.push({ level: 'note', text: `The after-repair value is in line with the renovated comparable sales entered (${usd(implied)} implied).` });
  } else {
    signals.push({ level: 'note', text: 'Enter the sold price per square foot of renovated houses of the same kind to check the after-repair value. A cabin, acreage or new-build sale does not price an older frame house.' });
  }
  return { facts, signals, cautions: signals.filter((signal) => signal.level === 'caution').map((signal) => signal.text) };
};
