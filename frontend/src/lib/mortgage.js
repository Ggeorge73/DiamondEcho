// Buyer Mortgage Simulator: the arithmetic. Everything here runs in the
// visitor's browser; nothing is sent anywhere. The figures are estimates from
// what the visitor types, not a loan offer. Formulas, sources and defaults are
// written out in docs/buyer-seller-calculators.md.

export const MORTGAGE_VERSION = 'diamond-mortgage-1.0.0';

// An adjustable loan here is a 30-year loan whose rate holds for `fixedYears`
// and then moves once, to a rate the visitor supplies. Real adjustable loans
// move again after that, within caps; the page says so.
export const LOAN_PROGRAMS = [
  { key: 'fixed30', label: '30-year fixed', years: 30 },
  { key: 'fixed20', label: '20-year fixed', years: 20 },
  { key: 'fixed15', label: '15-year fixed', years: 15 },
  { key: 'arm10', label: '10-year adjustable (30-year term)', years: 30, fixedYears: 10 },
  { key: 'arm7', label: '7-year adjustable (30-year term)', years: 30, fixedYears: 7 },
  { key: 'arm5', label: '5-year adjustable (30-year term)', years: 30, fixedYears: 5 },
];

// Used when the visitor has no tax figure: a share of the price per year. It is
// a placeholder, not a county's rate.
export const DEFAULT_PROPERTY_TAX_RATE = 1.2;
// Mortgage insurance is charged when the down payment is under 20% of the price.
export const PMI_REQUIRED_ABOVE_LTV = 0.8;
// Homeowners Protection Act: on a conventional loan the servicer ends mortgage
// insurance when the balance is first scheduled to reach 78% of the original
// value, and no later than the midpoint of the loan's term.
export const PMI_ENDS_AT_LTV = 0.78;
export const DEFAULT_PMI_RATE = 0.5;

const MAX_RATE = 30;
const cents = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

// Blank, negative and unreadable entries all count as zero, so a half-typed
// field never produces NaN on the page.
export const amount = (value) => {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

// The level payment that repays `principal` over `months` at `annualRatePct`.
export const monthlyPayment = (principal, annualRatePct, months) => {
  if (principal <= 0 || months <= 0) return 0;
  const monthlyRate = annualRatePct / 1200;
  if (monthlyRate === 0) return cents(principal / months);
  return cents((principal * monthlyRate) / (1 - (1 + monthlyRate) ** -months));
};

export const loanProgram = (key) => LOAN_PROGRAMS.find((program) => program.key === key) || LOAN_PROGRAMS[0];

export const simulateMortgage = (input = {}) => {
  const price = amount(input.price);
  const program = loanProgram(input.program);
  const months = program.years * 12;
  const fixedMonths = program.fixedYears ? program.fixedYears * 12 : null;

  const downEntered = amount(input.downPayment);
  const downPayment = cents(Math.min(price, input.downPaymentMode === 'amount' ? downEntered : (price * Math.min(downEntered, 100)) / 100));
  const loanAmount = cents(price - downPayment);
  const loanToValue = price > 0 ? loanAmount / price : 0;

  const rate = Math.min(amount(input.ratePct), MAX_RATE);
  const laterRateEntered = String(input.laterRatePct ?? '').trim() !== '';
  const laterRate = fixedMonths ? Math.min(laterRateEntered ? amount(input.laterRatePct) : rate, MAX_RATE) : null;

  const annualTax = cents(input.propertyTaxMode === 'amount' ? amount(input.propertyTax) : (price * amount(input.propertyTax)) / 100);
  const annualInsurance = cents(input.insuranceMode === 'month' ? amount(input.insurance) * 12 : amount(input.insurance));
  const hoa = cents(amount(input.hoaMonthly));

  const pmiRequired = loanAmount > 0 && loanToValue > PMI_REQUIRED_ABOVE_LTV + 1e-9;
  const pmiRate = amount(input.pmiRatePct);
  const pmiMonthly = pmiRequired ? cents((loanAmount * pmiRate) / 1200) : 0;
  const pmiStopsBelow = price * PMI_ENDS_AT_LTV;
  const pmiLastPossibleMonth = months / 2;

  const schedule = [];
  let balance = loanAmount;
  let currentRate = rate;
  let payment = monthlyPayment(loanAmount, rate, months);
  let pmiEndsAfterMonth = null;
  for (let month = 1; month <= months && balance > 0; month += 1) {
    if (fixedMonths && month === fixedMonths + 1) {
      currentRate = laterRate;
      payment = monthlyPayment(balance, laterRate, months - fixedMonths);
    }
    const interest = cents((balance * currentRate) / 1200);
    // The last payment clears whatever cents of balance rounding has left.
    const principal = month === months || payment - interest >= balance ? balance : cents(payment - interest);
    const pmi = pmiRequired && balance > pmiStopsBelow + 0.005 && month <= pmiLastPossibleMonth ? pmiMonthly : 0;
    if (pmi > 0) pmiEndsAfterMonth = month;
    balance = cents(balance - principal);
    schedule.push({ month, rate: currentRate, payment: cents(principal + interest), principal, interest, pmi, balance });
  }

  const years = [];
  schedule.forEach((row) => {
    const index = Math.ceil(row.month / 12) - 1;
    if (!years[index]) years[index] = { year: index + 1, payment: 0, principal: 0, interest: 0, pmi: 0, balance: 0 };
    const year = years[index];
    year.payment = cents(year.payment + row.payment);
    year.principal = cents(year.principal + row.principal);
    year.interest = cents(year.interest + row.interest);
    year.pmi = cents(year.pmi + row.pmi);
    year.balance = row.balance;
  });

  const first = schedule[0];
  const monthly = {
    principalInterest: first ? first.payment : 0,
    propertyTax: cents(annualTax / 12),
    insurance: cents(annualInsurance / 12),
    hoa,
    pmi: first ? first.pmi : 0,
  };
  monthly.total = cents(monthly.principalInterest + monthly.propertyTax + monthly.insurance + monthly.hoa + monthly.pmi);

  const afterReset = fixedMonths ? schedule[fixedMonths] : null;
  const adjustable = fixedMonths ? {
    fixedYears: program.fixedYears,
    laterRate,
    laterRateEntered,
    principalInterestAfter: afterReset ? afterReset.payment : 0,
    totalAfter: afterReset ? cents(afterReset.payment + monthly.propertyTax + monthly.insurance + monthly.hoa + afterReset.pmi) : 0,
  } : null;

  const sum = (key) => cents(schedule.reduce((total, row) => total + row[key], 0));
  const notes = [];
  if (price > 0 && loanAmount === 0) notes.push('The down payment covers the whole price, so there is no loan: the monthly figure is taxes, insurance and HOA only.');
  if (loanAmount > 0 && rate === 0) notes.push('No interest rate is entered, so the payment shown only repays the loan with no interest.');
  if (pmiRequired && pmiRate === 0) notes.push('The down payment is under 20%, so a lender would normally charge mortgage insurance, but the mortgage insurance rate is zero.');
  if (adjustable && !laterRateEntered) notes.push('No later rate is entered, so the schedule keeps the starting rate after the fixed period. An adjustable rate can rise.');

  return {
    version: MORTGAGE_VERSION,
    valid: price > 0,
    price,
    program,
    months,
    rate,
    downPayment,
    downPaymentPct: price > 0 ? (downPayment / price) * 100 : 0,
    loanAmount,
    loanToValue,
    annualTax,
    annualInsurance,
    monthly,
    pmi: { required: pmiRequired, ratePct: pmiRate, monthly: pmiMonthly, endsAfterMonth: pmiEndsAfterMonth, total: sum('pmi') },
    adjustable,
    schedule,
    years,
    totals: { interest: sum('interest'), principal: sum('principal'), payments: sum('payment') },
    notes,
  };
};

// The parts of the first month's payment, in the fixed order the chart uses.
export const paymentParts = (result) => [
  { key: 'principalInterest', label: 'Principal & interest', value: result.monthly.principalInterest },
  { key: 'propertyTax', label: 'Property taxes', value: result.monthly.propertyTax },
  { key: 'insurance', label: 'Homeowners insurance', value: result.monthly.insurance },
  { key: 'hoa', label: 'HOA / condo fees', value: result.monthly.hoa },
  { key: 'pmi', label: 'Mortgage insurance (PMI)', value: result.monthly.pmi },
];

// A link can carry a listing's price, yearly taxes and monthly HOA fee, so a
// page that knows them can open the simulator already filled in. Only plain
// positive numbers are accepted; anything else is ignored.
export const mortgagePrefillFromSearch = (search) => {
  const params = new URLSearchParams(search);
  const read = (name, max) => {
    const raw = params.get(name);
    if (raw === null || !/^\d{1,9}(\.\d{1,2})?$/.test(raw)) return null;
    const value = Number(raw);
    return value > 0 && value <= max ? value : null;
  };
  const prefill = { price: read('price', 500000000), taxes: read('taxes', 10000000), hoa: read('hoa', 100000) };
  return prefill.price === null ? null : prefill;
};
