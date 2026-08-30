import { analyzeDealLocally } from './dealAnalysis';
import { buildDealRequest } from './dealRequest';

export const DECISION_VERSION = 'diamond-decision-1.0.0';

export const RENTAL_EVIDENCE_ITEMS = [
  { key: 'rentRollVerified', label: 'Rent roll, leases, deposits, and delinquencies verified', action: 'Reconcile signed leases to the rent roll, bank deposits, concessions, delinquencies, notices, and security deposits.' },
  { key: 'legalUseVerified', label: 'Legal use, zoning, permits, and unit count verified', action: 'Obtain written zoning or legal-use confirmation plus permits, certificates of occupancy, and code history.' },
  { key: 'inspectionVerified', label: 'Physical inspection and capital plan completed', action: 'Complete property, roof, HVAC, plumbing, electrical, sewer, drainage, structure, environmental, and accessibility reviews as applicable.' },
  { key: 'taxVerified', label: 'Post-acquisition property tax confirmed', action: 'Obtain the assessor methodology and a written post-sale tax estimate; do not rely only on the seller’s current bill.' },
  { key: 'insuranceVerified', label: 'Binding insurance quote obtained', action: 'Obtain a binding quote covering property, liability, loss of rents, flood/wind and required lender endorsements.' },
  { key: 'lenderTermsVerified', label: 'Lender term sheet and debt sizing confirmed', action: 'Confirm proceeds, rate, amortization, reserves, covenants, recourse, prepayment, DSCR and debt-yield tests.' },
  { key: 'titleVerified', label: 'Title, survey, access, and liens reviewed', action: 'Review title commitment, survey, easements, access, encroachments, liens, open permits, and recorded restrictions.' },
];

const n = (value) => Number(value || 0);
const finite = (value) => Number.isFinite(value) ? value : null;
const roundDown = (value, increment = 5000) => Math.floor(Math.max(0, value) / increment) * increment;
const roundNearest = (value, increment = 5000) => Math.round(Math.max(0, value) / increment) * increment;

const metricValue = (analysis, key) => finite(analysis?.metrics?.[key]?.value);

const analyzeForm = (form) => analyzeDealLocally(buildDealRequest(form));

const atPrice = (form, purchasePrice) => {
  const originalPrice = n(form.purchasePrice);
  const closingRate = originalPrice > 0 ? n(form.closingCosts) / originalPrice : 0;
  return analyzeForm({
    ...form,
    purchasePrice: String(purchasePrice),
    closingCosts: String(purchasePrice * closingRate),
    explicitSalePrice: '',
  });
};

const findPriceCeiling = ({ form, metricKey, target, minimum = 1000 }) => {
  if (!(target > 0)) return null;
  const statedPrice = Math.max(n(form.purchasePrice), 100000);
  let lower = minimum;
  let upper = Math.min(50000000, Math.max(statedPrice * 3, 1000000));
  const passes = (price) => {
    try {
      const value = metricValue(atPrice(form, price), metricKey);
      return value !== null && value >= target;
    } catch {
      return false;
    }
  };
  if (!passes(lower)) return null;
  while (passes(upper) && upper < 50000000) upper = Math.min(50000000, upper * 2);
  if (passes(upper)) return upper;
  for (let iteration = 0; iteration < 56; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    if (passes(midpoint)) lower = midpoint;
    else upper = midpoint;
  }
  return Math.floor(lower);
};

const scaleOperatingExpenses = (form, multiplier) => ({
  propertyTaxes: String(n(form.propertyTaxes) * multiplier),
  insurance: String(n(form.insurance) * multiplier),
  repairsMaintenance: String(n(form.repairsMaintenance) * multiplier),
  utilities: String(n(form.utilities) * multiplier),
  payrollAdmin: String(n(form.payrollAdmin) * multiplier),
  reserves: String(n(form.reserves) * multiplier),
  annualBelowNoiCosts: String(n(form.annualBelowNoiCosts) * multiplier),
});

const buildScenario = (form, name, changes) => {
  const scenarioForm = { ...form, ...changes };
  const analysis = analyzeForm(scenarioForm);
  return {
    name,
    assumptions: changes,
    metrics: {
      noi: metricValue(analysis, 'noi'),
      capRate: metricValue(analysis, 'cap_rate'),
      cashOnCash: metricValue(analysis, 'cash_on_cash'),
      dscr: metricValue(analysis, 'dscr'),
      irr: metricValue(analysis, 'irr'),
      equityMultiple: metricValue(analysis, 'equity_multiple'),
    },
  };
};

const buildScenarios = (form) => [
  buildScenario(form, 'Downside', {
    annualRent: String(n(form.annualRent) * 0.9),
    otherIncome: String(n(form.otherIncome) * 0.9),
    vacancy: String(Math.min(50, n(form.vacancy) + 3)),
    interestRate: String(n(form.interestRate) + 0.5),
    exitCap: String(n(form.exitCap) + 0.75),
    initialCapex: String(n(form.initialCapex) * 1.25),
    ...scaleOperatingExpenses(form, 1.1),
  }),
  buildScenario(form, 'Base', {}),
  buildScenario(form, 'Upside', {
    annualRent: String(n(form.annualRent) * 1.1),
    otherIncome: String(n(form.otherIncome) * 1.1),
    vacancy: String(Math.max(0, n(form.vacancy) - 2)),
    interestRate: String(Math.max(0, n(form.interestRate) - 0.25)),
    exitCap: String(Math.max(0.1, n(form.exitCap) - 0.5)),
    initialCapex: String(n(form.initialCapex) * 0.75),
    ...scaleOperatingExpenses(form, 0.95),
  }),
];

export const buildRentalDecision = ({ form, evidence = {} }) => {
  if (form.strategy !== 'rental') return null;
  const targets = {
    cashOnCash: n(form.targetCashOnCash) / 100,
    dscr: n(form.minimumDscr),
    irr: n(form.targetIrr) / 100,
  };
  const ceilings = [
    { key: 'cashOnCash', label: `${n(form.targetCashOnCash)}% cash-on-cash`, value: findPriceCeiling({ form, metricKey: 'cash_on_cash', target: targets.cashOnCash }), source: 'Return hurdle' },
    { key: 'dscr', label: `${n(form.minimumDscr).toFixed(2)}× DSCR`, value: findPriceCeiling({ form, metricKey: 'dscr', target: targets.dscr }), source: 'Debt-service hurdle' },
    { key: 'irr', label: `${n(form.targetIrr)}% levered IRR`, value: findPriceCeiling({ form, metricKey: 'irr', target: targets.irr }), source: 'Hold-period hurdle' },
  ];
  if (n(form.preliminaryMarketCeiling) > 0) ceilings.push({ key: 'market', label: 'Preliminary market ceiling', value: n(form.preliminaryMarketCeiling), source: 'User-entered market evidence' });

  const validCeilings = ceilings.filter((item) => item.value !== null && item.value > 0);
  const exactMaximum = validCeilings.length ? Math.min(...validCeilings.map((item) => item.value)) : null;
  const recommendedMaximum = exactMaximum ? roundDown(exactMaximum) : null;
  const bindingKey = exactMaximum ? validCeilings.find((item) => item.value === exactMaximum)?.key : null;
  const askingPrice = n(form.purchasePrice);
  const base = analyzeForm(form);
  const baseMetrics = {
    cashOnCash: metricValue(base, 'cash_on_cash'), dscr: metricValue(base, 'dscr'), irr: metricValue(base, 'irr'),
  };
  const hurdleResults = [
    { label: 'Cash-on-cash', actual: baseMetrics.cashOnCash, target: targets.cashOnCash, pass: baseMetrics.cashOnCash !== null && baseMetrics.cashOnCash >= targets.cashOnCash, format: 'rate' },
    { label: 'DSCR', actual: baseMetrics.dscr, target: targets.dscr, pass: baseMetrics.dscr !== null && baseMetrics.dscr >= targets.dscr, format: 'multiple' },
    { label: 'Levered IRR', actual: baseMetrics.irr, target: targets.irr, pass: baseMetrics.irr !== null && baseMetrics.irr >= targets.irr, format: 'rate' },
  ];

  const verified = RENTAL_EVIDENCE_ITEMS.filter((item) => evidence[item.key]);
  const gaps = RENTAL_EVIDENCE_ITEMS.filter((item) => !evidence[item.key]);
  const confidence = verified.length >= 6 ? 'High' : verified.length >= 3 ? 'Medium' : 'Low';
  const capexThreshold = n(form.maxImmediateCapex);
  const taxThreshold = n(form.maxAnnualTaxes);
  const insuranceThreshold = n(form.maxAnnualInsurance);
  const walkAwaySignals = [];
  if (capexThreshold > 0 && n(form.initialCapex) > capexThreshold) walkAwaySignals.push(`Initial capital work exceeds the ${Math.round(capexThreshold).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} limit.`);
  if (taxThreshold > 0 && n(form.propertyTaxes) > taxThreshold) walkAwaySignals.push('Modeled annual property taxes exceed the stated limit.');
  if (insuranceThreshold > 0 && n(form.insurance) > insuranceThreshold) walkAwaySignals.push('Modeled annual insurance exceeds the stated limit.');

  let verdict = 'CONDITIONAL — VERIFY THE DEAL';
  let tone = 'amber';
  if (recommendedMaximum && askingPrice > recommendedMaximum * 1.05) { verdict = 'REPRICE OR PASS'; tone = 'red'; }
  else if (recommendedMaximum && askingPrice > recommendedMaximum) { verdict = 'NEGOTIATE TO THE CEILING'; tone = 'amber'; }
  else if (walkAwaySignals.length) { verdict = 'CONDITIONAL — RESOLVE EXCEPTIONS'; tone = 'red'; }
  else if (gaps.length === 0 && hurdleResults.every((item) => item.pass)) { verdict = 'PROCEED TO DILIGENCE'; tone = 'green'; }

  const gapToAsk = recommendedMaximum === null ? null : askingPrice - recommendedMaximum;
  const openingLow = recommendedMaximum ? roundNearest(recommendedMaximum * 0.92) : null;
  const openingHigh = recommendedMaximum ? roundNearest(recommendedMaximum * 0.97) : null;

  return {
    version: DECISION_VERSION,
    verdict,
    tone,
    confidence,
    evidenceVerified: verified.length,
    evidenceTotal: RENTAL_EVIDENCE_ITEMS.length,
    evidenceGaps: gaps,
    hurdleResults,
    ceilings: ceilings.map((item) => ({ ...item, binding: item.key === bindingKey })),
    exactMaximum,
    recommendedMaximum,
    askingPrice,
    gapToAsk,
    openingRange: recommendedMaximum ? [openingLow, openingHigh] : null,
    targetRange: recommendedMaximum ? [openingHigh, recommendedMaximum] : null,
    scenarios: buildScenarios(form),
    walkAwaySignals,
    summary: recommendedMaximum
      ? askingPrice > recommendedMaximum
        ? `The proposed price exceeds the return-constrained ceiling by ${Math.round(gapToAsk).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}. Reprice the basis or improve verified income, expenses, financing, or seller economics.`
        : `The proposed price is within the modeled return ceiling, subject to complete evidence and diligence.`
      : 'No defensible maximum offer could be established from the selected hurdles. Review the assumptions before proceeding.',
    valuationNotice: 'This is an investment-value ceiling based on the entered assumptions—not an appraisal, broker price opinion, or representation of market value.',
  };
};
