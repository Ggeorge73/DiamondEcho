// Buyer Mortgage Simulator: the arithmetic. Everything here runs in the
// visitor's browser; nothing is sent anywhere. The figures are estimates from
// what the visitor types, not a loan offer. Formulas, sources and defaults are
// written out in docs/buyer-seller-calculators.md and docs/mortgage-simulator-v2.md.

export const MORTGAGE_VERSION = 'diamond-mortgage-2.0.0';

// An adjustable loan here is a 30-year loan whose rate holds for `fixedYears`
// and then moves once, to a rate the visitor supplies. A second, worst-case
// path follows the loan's caps (below). `caps` are the usual ones for that
// product; the visitor's note governs and the page says so.
export const LOAN_PROGRAMS = [
  { key: 'fixed30', label: '30-year fixed', years: 30 },
  { key: 'fixed20', label: '20-year fixed', years: 20 },
  { key: 'fixed15', label: '15-year fixed', years: 15 },
  { key: 'arm10', label: '10-year adjustable (30-year term)', years: 30, fixedYears: 10, caps: { initial: 5, periodic: 1, lifetime: 5 } },
  { key: 'arm7', label: '7-year adjustable (30-year term)', years: 30, fixedYears: 7, caps: { initial: 5, periodic: 1, lifetime: 5 } },
  { key: 'arm5', label: '5-year adjustable (30-year term)', years: 30, fixedYears: 5, caps: { initial: 2, periodic: 1, lifetime: 5 } },
];

// Loan types. Minimum down payments are the programs' own; upfront and annual
// fees are the published ones (sources in docs/mortgage-simulator-v2.md):
// FHA upfront MIP 1.75% and annual MIP by term, LTV and loan size (HUD);
// VA funding fee by use and down payment (VA, effective 2023-04-07);
// USDA 1.00% upfront and 0.35% annual (Rural Development, FY2026 and FY2027).
// Debt-to-income limits are the usual manual-underwriting ceilings; automated
// underwriting often allows more, and the page says so.
export const LOAN_TYPES = [
  { key: 'conventional', label: 'Conventional', minDownPct: 3, miName: 'Mortgage insurance (PMI)', dti: { front: null, back: 45 }, primaryOnly: false },
  { key: 'fha', label: 'FHA', minDownPct: 3.5, miName: 'FHA mortgage insurance (MIP)', upfrontPct: 1.75, dti: { front: 31, back: 43 }, primaryOnly: true },
  { key: 'va', label: 'VA', minDownPct: 0, miName: 'Mortgage insurance', dti: { front: null, back: 41 }, primaryOnly: true },
  { key: 'usda', label: 'USDA Rural Development', minDownPct: 0, miName: 'USDA annual fee', upfrontPct: 1.0, annualFeePct: 0.35, dti: { front: 29, back: 41 }, primaryOnly: true },
];

export const loanType = (key) => LOAN_TYPES.find((type) => type.key === key) || LOAN_TYPES[0];

// FHA annual MIP, loans over 15 years, by loan size and base LTV. The loan-size
// tier is the one in HUD's schedule. Duration: 11 years at 90% LTV or less,
// otherwise the life of the loan.
export const FHA_MIP_LOAN_TIER = 726200;
export const fhaAnnualMipPct = (baseLoan, ltv, years) => {
  const large = baseLoan > FHA_MIP_LOAN_TIER;
  if (years > 15) {
    if (ltv <= 0.90) return large ? 0.70 : 0.50;
    if (ltv <= 0.95) return large ? 0.70 : 0.50;
    return large ? 0.75 : 0.55;
  }
  if (!large) return ltv <= 0.90 ? 0.15 : 0.40;
  if (ltv <= 0.78) return 0.15;
  if (ltv <= 0.90) return 0.40;
  return 0.65;
};
export const fhaMipMonths = (ltv, months) => (ltv <= 0.90 + 1e-9 ? Math.min(132, months) : months);

// VA funding fee for a purchase, by down payment and whether the entitlement
// has been used before. Exempt borrowers (a service-connected disability rating
// of 10% or more, certain surviving spouses, Purple Heart recipients) pay none.
export const vaFundingFeePct = (downPct, firstUse) => {
  if (downPct >= 10) return 1.25;
  if (downPct >= 5) return 1.5;
  return firstUse ? 2.15 : 3.3;
};

// Credit score bands. They drive the conventional PMI rate below; the interest
// rate is still the lender's quote, typed by the visitor.
export const CREDIT_BANDS = [
  { key: '760', label: '760 or higher' },
  { key: '740', label: '740 – 759' },
  { key: '720', label: '720 – 739' },
  { key: '700', label: '700 – 719' },
  { key: '680', label: '680 – 699' },
  { key: '660', label: '660 – 679' },
  { key: '640', label: '640 – 659' },
  { key: '620', label: '620 – 639' },
  { key: '580', label: 'Below 620' },
];

// Conventional borrower-paid monthly PMI, percent of the loan a year, for a
// fixed loan over 20 years. The grid is representative of published mortgage
// insurer rate cards; the insurer's card for the actual loan governs. Rows are
// LTV bands, columns follow CREDIT_BANDS.
export const PMI_GRID = [
  { maxLtv: 0.85, rates: [0.19, 0.20, 0.23, 0.27, 0.33, 0.42, 0.45, 0.50, 0.50] },
  { maxLtv: 0.90, rates: [0.28, 0.38, 0.46, 0.52, 0.65, 0.84, 0.85, 0.95, 0.95] },
  { maxLtv: 0.95, rates: [0.38, 0.53, 0.66, 0.78, 0.96, 1.28, 1.33, 1.50, 1.50] },
  { maxLtv: 0.97, rates: [0.58, 0.70, 0.87, 0.99, 1.21, 1.54, 1.65, 1.86, 1.86] },
];
export const pmiRateFor = (ltv, creditBand) => {
  const column = Math.max(0, CREDIT_BANDS.findIndex((band) => band.key === creditBand));
  const row = PMI_GRID.find((item) => ltv <= item.maxLtv + 1e-9) || PMI_GRID[PMI_GRID.length - 1];
  return row.rates[column];
};

// Metro Atlanta counties with an effective property tax rate, percent of the
// home's value a year. They are 2023 medians (median taxes paid over median
// home value, Georgia Public Policy Foundation), which reflect homesteaded
// owners; a new buyer's first bill is often higher. Placeholders, not quotes.
export const GEORGIA_COUNTIES = [
  { key: 'fulton', label: 'Fulton', ratePct: 0.89 },
  { key: 'dekalb', label: 'DeKalb', ratePct: 0.92 },
  { key: 'gwinnett', label: 'Gwinnett', ratePct: 0.98 },
  { key: 'cobb', label: 'Cobb', ratePct: 0.69 },
  { key: 'forsyth', label: 'Forsyth', ratePct: 0.76 },
  { key: 'cherokee', label: 'Cherokee', ratePct: 0.70 },
  { key: 'clayton', label: 'Clayton', ratePct: 0.89 },
  { key: 'henry', label: 'Henry', ratePct: 0.92 },
  { key: 'hall', label: 'Hall', ratePct: 0.76 },
  { key: 'douglas', label: 'Douglas', ratePct: 0.79 },
  { key: 'paulding', label: 'Paulding', ratePct: 0.85 },
  { key: 'rockdale', label: 'Rockdale', ratePct: 0.72 },
  { key: 'fayette', label: 'Fayette', ratePct: 0.78 },
  { key: 'barrow', label: 'Barrow', ratePct: 0.83 },
];
export const georgiaCounty = (key) => GEORGIA_COUNTIES.find((county) => county.key === key) || null;

// Used when the visitor has no tax figure and no county: a share of the price
// per year. It is a placeholder, not a county's rate.
export const DEFAULT_PROPERTY_TAX_RATE = 1.2;
// Mortgage insurance is charged when the down payment is under 20% of the price.
export const PMI_REQUIRED_ABOVE_LTV = 0.8;
// Homeowners Protection Act: on a conventional loan the servicer ends mortgage
// insurance when the balance is first scheduled to reach 78% of the original
// value, and no later than the midpoint of the loan's term.
export const PMI_ENDS_AT_LTV = 0.78;
export const DEFAULT_PMI_RATE = 0.5;

// Georgia intangible recording tax on a long-term note secured by real estate:
// $1.50 for each $500, or fraction of $500, of the note, capped at $25,000.
// O.C.G.A. 48-6-61; the lender passes it to the borrower in a purchase.
export const INTANGIBLE_TAX_CAP = 25000;
export const georgiaIntangibleTax = (noteAmount) => (noteAmount <= 0 ? 0 : Math.min(INTANGIBLE_TAX_CAP, Math.ceil(noteAmount / 500) * 1.5));

// Seller concession caps, percent of the price, by loan type and down payment.
export const sellerConcessionCapPct = (type, downPct) => {
  if (type.key === 'fha' || type.key === 'usda') return 6;
  if (type.key === 'va') return 4;
  if (downPct < 10) return 3;
  if (downPct < 25) return 6;
  return 9;
};

// Temporary buydowns: the rate the buyer pays in each early year, below the note rate.
export const BUYDOWNS = [
  { key: 'none', label: 'None', steps: [] },
  { key: '2-1', label: '2-1 buydown (2 points lower in year 1, 1 in year 2)', steps: [2, 1] },
  { key: '1-0', label: '1-0 buydown (1 point lower in year 1)', steps: [1] },
];
export const buydown = (key) => BUYDOWNS.find((item) => item.key === key) || BUYDOWNS[0];

const MAX_RATE = 30;
const cents = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

// Blank, negative and unreadable entries all count as zero, so a half-typed
// field never produces NaN on the page.
export const amount = (value) => {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};
const flag = (value, fallback) => (value === undefined || value === null || value === '' ? fallback : value === true || value === 'true' || value === 'yes' || value === 'on');

// The level payment that repays `principal` over `months` at `annualRatePct`.
export const monthlyPayment = (principal, annualRatePct, months) => {
  if (principal <= 0 || months <= 0) return 0;
  const monthlyRate = annualRatePct / 1200;
  if (monthlyRate === 0) return cents(principal / months);
  return cents((principal * monthlyRate) / (1 - (1 + monthlyRate) ** -months));
};

export const loanProgram = (key) => LOAN_PROGRAMS.find((program) => program.key === key) || LOAN_PROGRAMS[0];

// Everything that decides the loan before the schedule is run: price, down
// payment, type, upfront fee, mortgage insurance rate and duration.
const resolveLoan = (input, priceOverride) => {
  const price = priceOverride ?? amount(input.price);
  const program = loanProgram(input.program);
  const type = loanType(input.loanType);
  const months = program.years * 12;

  const downEntered = amount(input.downPayment);
  const downPayment = cents(Math.min(price, input.downPaymentMode === 'amount' ? downEntered : (price * Math.min(downEntered, 100)) / 100));
  const baseLoan = cents(price - downPayment);
  const loanToValue = price > 0 ? baseLoan / price : 0;
  const downPct = price > 0 ? (downPayment / price) * 100 : 0;

  // Upfront fee: FHA UFMIP, VA funding fee, USDA guarantee fee. Financed into
  // the loan by default, as nearly every borrower does.
  const vaFirstUse = flag(input.vaFirstUse, true);
  const vaExempt = flag(input.vaExempt, false);
  let upfrontPct = 0;
  if (baseLoan > 0) {
    if (type.key === 'fha') upfrontPct = type.upfrontPct;
    if (type.key === 'usda') upfrontPct = type.upfrontPct;
    if (type.key === 'va') upfrontPct = vaExempt ? 0 : vaFundingFeePct(downPct, vaFirstUse);
  }
  const upfrontFee = cents((baseLoan * upfrontPct) / 100);
  const financeUpfront = flag(input.financeUpfrontFee, true) && upfrontFee > 0;
  const loanAmount = cents(baseLoan + (financeUpfront ? upfrontFee : 0));

  // Monthly mortgage insurance, and how long it lasts.
  const creditBand = CREDIT_BANDS.some((band) => band.key === input.creditBand) ? input.creditBand : '740';
  let miRatePct = 0;
  let miMonths = 0;
  let miMode = 'none';
  let miDeclining = false;
  if (baseLoan > 0) {
    if (type.key === 'conventional' && loanToValue > PMI_REQUIRED_ABOVE_LTV + 1e-9) {
      const manual = input.pmiRateMode === 'manual' || (input.pmiRateMode === undefined && input.pmiRatePct !== undefined);
      miRatePct = manual ? amount(input.pmiRatePct) : pmiRateFor(loanToValue, creditBand);
      miMode = manual ? 'manual' : 'grid';
      miMonths = months / 2;
    } else if (type.key === 'fha') {
      miRatePct = fhaAnnualMipPct(baseLoan, loanToValue, program.years);
      miMonths = fhaMipMonths(loanToValue, months);
      miMode = 'fha';
      miDeclining = true;
    } else if (type.key === 'usda') {
      miRatePct = type.annualFeePct;
      miMonths = months;
      miMode = 'usda';
      miDeclining = true;
    }
  }

  return {
    price, program, type, months, downPayment, downPct, baseLoan, loanToValue, loanAmount,
    upfrontPct, upfrontFee, financeUpfront, vaFirstUse, vaExempt, creditBand, miRatePct, miMonths, miMode, miDeclining,
  };
};

const resolveEscrow = (input, loan) => {
  const county = georgiaCounty(input.county);
  const taxPct = input.propertyTaxMode === 'amount' ? null : amount(input.propertyTax);
  const annualTax = cents(input.propertyTaxMode === 'amount' ? amount(input.propertyTax) : (loan.price * (taxPct ?? 0)) / 100);
  const annualInsurance = cents(input.insuranceMode === 'month' ? amount(input.insurance) * 12 : amount(input.insurance));
  const hoa = cents(amount(input.hoaMonthly));
  return { county, annualTax, annualInsurance, hoa };
};

// The first month's housing payment for a given price, used by the affordability search.
const firstMonthTotal = (input, price) => {
  const loan = resolveLoan(input, price);
  const rate = Math.min(amount(input.ratePct), MAX_RATE);
  const { annualTax, annualInsurance, hoa } = resolveEscrow(input, loan);
  const pi = monthlyPayment(loan.loanAmount, rate, loan.months);
  const mi = loan.miRatePct > 0 ? cents(((loan.miDeclining ? loan.loanAmount : loan.baseLoan) * loan.miRatePct) / 1200) : 0;
  return cents(pi + annualTax / 12 + annualInsurance / 12 + hoa + mi);
};

export const simulateMortgage = (input = {}) => {
  const loan = resolveLoan(input);
  const { price, program, type, months, downPayment, downPct, baseLoan, loanToValue, loanAmount, upfrontFee, financeUpfront } = loan;
  const fixedMonths = program.fixedYears ? program.fixedYears * 12 : null;
  const primaryResidence = flag(input.primaryResidence, true);

  const rate = Math.min(amount(input.ratePct), MAX_RATE);
  const laterRateEntered = String(input.laterRatePct ?? '').trim() !== '';
  const laterRate = fixedMonths ? Math.min(laterRateEntered ? amount(input.laterRatePct) : rate, MAX_RATE) : null;

  const { county, annualTax, annualInsurance, hoa } = resolveEscrow(input, loan);

  const miRequired = loan.miRatePct > 0 || loan.miMode === 'manual';
  const pmiStopsBelow = price * PMI_ENDS_AT_LTV;

  // The schedule. Interest is charged at the note rate; a temporary buydown
  // changes what the buyer pays in the early years, not how the loan amortises.
  const schedule = [];
  let balance = loanAmount;
  let currentRate = rate;
  let payment = monthlyPayment(loanAmount, rate, months);
  let miEndsAfterMonth = null;
  const conventionalMi = loan.miMode === 'grid' || loan.miMode === 'manual';
  const flatMi = conventionalMi ? cents((baseLoan * loan.miRatePct) / 1200) : 0;
  for (let month = 1; month <= months && balance > 0; month += 1) {
    if (fixedMonths && month === fixedMonths + 1) {
      currentRate = laterRate;
      payment = monthlyPayment(balance, laterRate, months - fixedMonths);
    }
    const interest = cents((balance * currentRate) / 1200);
    // The last payment clears whatever cents of balance rounding has left.
    const principal = month === months || payment - interest >= balance ? balance : cents(payment - interest);
    let pmi = 0;
    if (conventionalMi && balance > pmiStopsBelow + 0.005 && month <= loan.miMonths) pmi = flatMi;
    if (loan.miDeclining && month <= loan.miMonths) pmi = cents((balance * loan.miRatePct) / 1200);
    if (pmi > 0) miEndsAfterMonth = month;
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
  const escrowMonthly = cents(monthly.propertyTax + monthly.insurance + monthly.hoa);

  // Temporary buydown: what the buyer pays in the reduced years, and what it costs.
  const buydownPlan = buydown(input.buydown);
  let buydownResult = null;
  if (buydownPlan.steps.length > 0 && loanAmount > 0 && rate > 0) {
    const yearsOut = buydownPlan.steps.map((drop, index) => {
      const reducedRate = Math.max(0, rate - drop);
      const reducedPi = monthlyPayment(loanAmount, reducedRate, months);
      return { year: index + 1, rate: reducedRate, principalInterest: reducedPi, total: cents(reducedPi + escrowMonthly + monthly.pmi), subsidyMonthly: cents(monthly.principalInterest - reducedPi) };
    });
    buydownResult = { key: buydownPlan.key, years: yearsOut, cost: cents(yearsOut.reduce((sum, year) => sum + year.subsidyMonthly * 12, 0)) };
  }

  // Adjustable: the visitor's own path, and the worst case the caps allow.
  const afterReset = fixedMonths ? schedule[fixedMonths] : null;
  let adjustable = null;
  if (fixedMonths) {
    const caps = program.caps;
    const maxRate = Math.min(rate + caps.lifetime, MAX_RATE);
    let worstRate = Math.min(rate + caps.initial, maxRate);
    let worstMonth = fixedMonths + 1;
    while (worstRate < maxRate - 1e-9 && worstMonth + 12 <= months) { worstMonth += 12; worstRate = Math.min(worstRate + caps.periodic, maxRate); }
    // The balance owing when the rate first reaches its ceiling, which is the
    // balance after the month before.
    const worstBalance = worstMonth >= 2 && schedule[worstMonth - 2] ? schedule[worstMonth - 2].balance : loanAmount;
    const worstPi = monthlyPayment(worstBalance, worstRate, Math.max(1, months - worstMonth + 1));
    adjustable = {
      fixedYears: program.fixedYears,
      laterRate,
      laterRateEntered,
      principalInterestAfter: afterReset ? afterReset.payment : 0,
      totalAfter: afterReset ? cents(afterReset.payment + escrowMonthly + afterReset.pmi) : 0,
      caps,
      worstCase: { rate: worstRate, reachedYear: Math.ceil(worstMonth / 12), principalInterest: worstPi, total: cents(worstPi + escrowMonthly) },
    };
  }

  // Extra principal each month: when the loan ends and what it saves.
  const extraMonthly = cents(amount(input.extraMonthly));
  let extra = null;
  if (extraMonthly > 0 && loanAmount > 0 && !fixedMonths) {
    let bal = loanAmount;
    let interestPaid = 0;
    let m = 0;
    while (bal > 0 && m < months) {
      m += 1;
      const interest = cents((bal * rate) / 1200);
      interestPaid = cents(interestPaid + interest);
      const principal = Math.min(bal, cents(payment - interest + extraMonthly));
      bal = cents(bal - principal);
    }
    extra = { monthly: extraMonthly, payoffMonth: m, monthsSaved: months - m, interestSaved: cents(schedule.reduce((sum, row) => sum + row.interest, 0) - interestPaid) };
  }

  // Cash to close.
  const sum = (key) => cents(schedule.reduce((total, row) => total + row[key], 0));
  const pointsPct = Math.min(amount(input.pointsPct), 10);
  const points = cents((baseLoan * pointsPct) / 100);
  const intangibleTax = cents(georgiaIntangibleTax(loanAmount));
  const lenderFees = cents(amount(input.lenderFees));
  const attorneyTitle = cents(amount(input.attorneyTitle));
  const recordingOther = cents(amount(input.recordingOther));
  const hoaInitiation = cents(amount(input.hoaInitiation));
  const appraisalInspection = cents(amount(input.appraisalInspection));
  const escrowMonths = Math.min(14, Math.round(amount(input.escrowMonths ?? 3)));
  const prepaidInterestDays = Math.min(31, Math.round(amount(input.prepaidInterestDays ?? 15)));
  const earnestMoney = cents(Math.min(amount(input.earnestMoney), downPayment));
  const upfrontAtClosing = financeUpfront ? 0 : upfrontFee;

  const closingCosts = cents(lenderFees + attorneyTitle + recordingOther + intangibleTax + points + hoaInitiation + upfrontAtClosing);
  const escrowReserve = cents(escrowMonths * (annualTax / 12 + annualInsurance / 12));
  const prepaidInterest = cents((loanAmount * rate) / 100 / 365 * prepaidInterestDays);
  const prepaids = cents(annualInsurance + escrowReserve + prepaidInterest);

  const sellerCreditEntered = cents(amount(input.sellerCredit));
  const concessionCapPct = sellerConcessionCapPct(type, downPct);
  const concessionCap = cents((price * concessionCapPct) / 100);
  const creditCeiling = Math.min(concessionCap, cents(closingCosts + prepaids));
  const sellerCredit = cents(Math.min(sellerCreditEntered, creditCeiling));

  const cashToClose = cents(Math.max(0, downPayment + closingCosts + prepaids - sellerCredit - earnestMoney));
  const cash = {
    downPayment, closingCosts, prepaids, sellerCredit, sellerCreditEntered, concessionCapPct, concessionCap, earnestMoney, appraisalInspection,
    lines: { lenderFees, attorneyTitle, recordingOther, intangibleTax, points, pointsPct, hoaInitiation, upfrontAtClosing, firstYearInsurance: annualInsurance, escrowReserve, escrowMonths, prepaidInterest, prepaidInterestDays },
    dueAtClosing: cashToClose,
    totalNeeded: cents(cashToClose + earnestMoney + appraisalInspection),
  };

  // Affordability: debt-to-income on this purchase, and the price the same
  // income would carry at the program's usual ceiling.
  const annualIncome = amount(input.annualIncome);
  const monthlyIncome = cents(annualIncome / 12);
  const monthlyDebts = cents(amount(input.monthlyDebts));
  let affordability = null;
  if (monthlyIncome > 0) {
    const housing = monthly.total;
    const frontPct = (housing / monthlyIncome) * 100;
    const backPct = ((housing + monthlyDebts) / monthlyIncome) * 100;
    const limitBack = (monthlyIncome * type.dti.back) / 100 - monthlyDebts;
    const limitFront = type.dti.front ? (monthlyIncome * type.dti.front) / 100 : Infinity;
    const housingCeiling = cents(Math.max(0, Math.min(limitBack, limitFront)));
    let low = 0;
    let high = 20000000;
    for (let i = 0; i < 48; i += 1) {
      const mid = (low + high) / 2;
      if (firstMonthTotal(input, mid) <= housingCeiling) low = mid; else high = mid;
    }
    affordability = {
      monthlyIncome, monthlyDebts, frontPct, backPct, limits: type.dti, housingCeiling,
      maxPrice: Math.floor(low / 1000) * 1000,
      withinLimits: backPct <= type.dti.back + 1e-9 && (!type.dti.front || frontPct <= type.dti.front + 1e-9),
    };
  }

  const notes = [];
  if (price > 0 && baseLoan === 0) notes.push('The down payment covers the whole price, so there is no loan: the monthly figure is taxes, insurance and HOA only.');
  if (baseLoan > 0 && rate === 0) notes.push('No interest rate is entered, so the payment shown only repays the loan with no interest.');
  if (baseLoan > 0 && downPct < type.minDownPct - 1e-9) notes.push(`${type.label} loans need at least ${type.minDownPct}% down (${type.key === 'conventional' ? 'first-time buyers; otherwise 5%' : 'with a credit score of 580 or more'}). The figures assume a lender allows this down payment.`);
  if (baseLoan > 0 && type.primaryOnly && !primaryResidence) notes.push(`${type.label} loans are for a home you will live in. For a second home or investment property the lender will need a conventional loan, usually at a higher rate.`);
  if (type.key === 'conventional' && loan.creditBand === '580' && baseLoan > 0) notes.push('Most conventional lenders need a score of 620 or more. Below that, FHA is the usual route; the PMI shown uses the lowest band on the card.');
  if (loan.miMode === 'manual' && loan.miRatePct === 0) notes.push('The down payment is under 20%, so a lender would normally charge mortgage insurance, but the mortgage insurance rate is zero.');
  if (adjustable && !laterRateEntered) notes.push('No later rate is entered, so the schedule keeps the starting rate after the fixed period. An adjustable rate can rise.');
  if (sellerCreditEntered > concessionCap + 0.005) notes.push(`A seller can pay at most ${concessionCapPct}% of the price toward your costs on a ${type.label} loan with this down payment, so the credit is held at that cap.`);
  else if (sellerCreditEntered > sellerCredit + 0.005) notes.push('A seller credit can only pay closing costs and prepaids, not the down payment, so it is held at the total of those.');
  if (!primaryResidence && (type.key === 'conventional')) notes.push('An investment or second home gets no homestead exemption, so expect a higher tax bill than a county figure built from homesteaded owners, and a higher rate from the lender.');
  if (extraMonthly > 0 && fixedMonths) notes.push('Extra payments are shown for fixed-rate loans only.');

  return {
    version: MORTGAGE_VERSION,
    valid: price > 0,
    price,
    program,
    type,
    months,
    rate,
    downPayment,
    downPaymentPct: downPct,
    baseLoan,
    loanAmount,
    loanToValue,
    upfront: { pct: loan.upfrontPct, amount: upfrontFee, financed: financeUpfront, vaFirstUse: loan.vaFirstUse, vaExempt: loan.vaExempt },
    creditBand: loan.creditBand,
    county,
    primaryResidence,
    annualTax,
    annualInsurance,
    monthly,
    pmi: { required: miRequired, ratePct: loan.miRatePct, mode: loan.miMode, monthly: first ? first.pmi : 0, endsAfterMonth: miEndsAfterMonth, total: sum('pmi'), name: type.miName, lifeOfLoan: miRequired && loan.miMonths >= months && loan.miDeclining },
    buydown: buydownResult,
    adjustable,
    extra,
    cash,
    affordability,
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
  { key: 'pmi', label: result.type ? result.type.miName : 'Mortgage insurance (PMI)', value: result.monthly.pmi },
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

// A short plain-text summary of the estimate, for the visitor to print or, if
// they choose, to paste into a request. It carries figures only, never a name.
export const summarizeMortgage = (result) => {
  if (!result.valid) return '';
  const usd = (value) => `$${Math.round(value).toLocaleString('en-US')}`;
  const lines = [
    `Price ${usd(result.price)}, ${Math.round(result.downPaymentPct * 10) / 10}% down (${usd(result.downPayment)}), ${result.type.label} ${result.program.label} at ${result.rate}%.`,
    `Estimated monthly payment ${usd(result.monthly.total)}${result.pmi.required ? ` including ${usd(result.monthly.pmi)} mortgage insurance` : ''}.`,
    `Estimated cash to close ${usd(result.cash.dueAtClosing)} (total cash needed ${usd(result.cash.totalNeeded)}).`,
  ];
  if (result.affordability) lines.push(`Debt-to-income on this purchase ${Math.round(result.affordability.backPct)}%; estimated maximum price ${usd(result.affordability.maxPrice)}.`);
  return lines.join(' ');
};
