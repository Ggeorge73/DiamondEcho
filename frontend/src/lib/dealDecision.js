import { analyzeDealLocally, capPinnedLoans, pinLoans } from './dealAnalysis';
import { buildDealRequest } from './dealRequest';
import { classifyFloodZone, floodZoneVerified } from './floodZone';
import { arvChecks, buildListingSignals, holdingCostParts } from './listingSignals';

// 1.1.0 (2026-10-06): land development gets a Go / No-Go decision.
// 1.2.0 (2026-10-22): fix and flip gets a Go / No-Go decision and the highest
// price that meets a minimum profit and a return on cash.
// 1.3.0 (2026-10-22): in the land Downside and Upside cases the cost change
// replaces the contingency instead of being applied on top of it.
// 1.4.0 (2026-10-22): the flip decision reads the listing history and seller
// posture, checks the after-repair value per square foot, and checks the
// holding costs against their parts.
export const DECISION_VERSION = 'diamond-decision-1.4.0';

const EXPLICIT_EXIT_DOWNSIDE_MULTIPLIER = 0.9;
const EXPLICIT_EXIT_UPSIDE_MULTIPLIER = 1.1;

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
  });
};

const findPriceCeiling = ({ form, metricKey, target, minimum = 1000, analyzeAt = atPrice, allowZeroTarget = false }) => {
  if (!Number.isFinite(target) || (!allowZeroTarget && !(target > 0))) return null;
  const statedPrice = Math.max(n(form.purchasePrice), 100000);
  let lower = minimum;
  let upper = Math.min(50000000, Math.max(statedPrice * 3, 1000000));
  const passes = (price) => {
    try {
      const value = metricValue(analyzeAt(form, price), metricKey);
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
      salePrice: metricValue(analysis, 'sale_price'),
    },
  };
};

const downsideExitChanges = (form) => n(form.explicitSalePrice) > 0
  ? { explicitSalePrice: String(n(form.explicitSalePrice) * EXPLICIT_EXIT_DOWNSIDE_MULTIPLIER) }
  : { exitCap: String(n(form.exitCap) + 0.75) };

const upsideExitChanges = (form) => n(form.explicitSalePrice) > 0
  ? { explicitSalePrice: String(n(form.explicitSalePrice) * EXPLICIT_EXIT_UPSIDE_MULTIPLIER) }
  : { exitCap: String(Math.max(0.1, n(form.exitCap) - 0.5)) };

const buildScenarios = (form) => [
  buildScenario(form, 'Downside', {
    annualRent: String(n(form.annualRent) * 0.9),
    otherIncome: String(n(form.otherIncome) * 0.9),
    vacancy: String(Math.min(50, n(form.vacancy) + 3)),
    interestRate: String(n(form.interestRate) + 0.5),
    ...downsideExitChanges(form),
    initialCapex: String(n(form.initialCapex) * 1.25),
    ...scaleOperatingExpenses(form, 1.1),
  }),
  buildScenario(form, 'Base', {}),
  buildScenario(form, 'Upside', {
    annualRent: String(n(form.annualRent) * 1.1),
    otherIncome: String(n(form.otherIncome) * 1.1),
    vacancy: String(Math.max(0, n(form.vacancy) - 2)),
    interestRate: String(Math.max(0, n(form.interestRate) - 0.25)),
    ...upsideExitChanges(form),
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
  const hasExactMaximum = exactMaximum !== null;
  const recommendedMaximum = hasExactMaximum ? roundDown(exactMaximum) : null;
  const bindingKey = hasExactMaximum ? validCeilings.find((item) => item.value === exactMaximum)?.key : null;
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
  if (hasExactMaximum && askingPrice > exactMaximum * 1.05) { verdict = 'REPRICE OR PASS'; tone = 'red'; }
  else if (hasExactMaximum && askingPrice > exactMaximum) { verdict = 'NEGOTIATE TO THE CEILING'; tone = 'amber'; }
  else if (walkAwaySignals.length) { verdict = 'CONDITIONAL — RESOLVE EXCEPTIONS'; tone = 'red'; }
  else if (gaps.length === 0 && hurdleResults.every((item) => item.pass)) { verdict = 'PROCEED TO DILIGENCE'; tone = 'green'; }

  const gapToAsk = recommendedMaximum === null ? null : askingPrice - recommendedMaximum;
  const hasPositiveRecommendedMaximum = recommendedMaximum !== null && recommendedMaximum > 0;
  const openingLow = hasPositiveRecommendedMaximum ? roundNearest(recommendedMaximum * 0.92) : null;
  const openingHigh = hasPositiveRecommendedMaximum ? roundNearest(recommendedMaximum * 0.97) : null;

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
    openingRange: hasPositiveRecommendedMaximum ? [openingLow, openingHigh] : null,
    targetRange: hasPositiveRecommendedMaximum ? [openingHigh, recommendedMaximum] : null,
    scenarios: buildScenarios(form),
    walkAwaySignals,
    summary: hasExactMaximum
      ? askingPrice > exactMaximum
        ? `The proposed price exceeds the return-constrained ceiling by ${Math.round(gapToAsk).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}. Reprice the basis or improve verified income, expenses, financing, or seller economics.`
        : `The proposed price is within the modeled return ceiling, subject to complete evidence and diligence.`
      : 'No defensible maximum offer could be established from the selected hurdles. Review the assumptions before proceeding.',
    valuationNotice: 'This is an investment-value ceiling based on the entered assumptions—not an appraisal, broker price opinion, or representation of market value.',
  };
};

// ---------------------------------------------------------------------------
// Land development: Go / No-Go (DE-25).
//
// Six of the ten evidence items are read from the diligence answers already on
// the form; the other four are ticked by hand.
export const LAND_EVIDENCE_ITEMS = [
  { key: 'landEntitlement', label: 'Entitlements in place for the planned use', action: 'Obtain written zoning confirmation and the approvals the plan depends on; allow for the time and cost of any rezoning.', fromForm: (form) => ['fully_entitled', 'shovel_ready'].includes(form.entitlementStatus) },
  { key: 'landUtilities', label: 'Utility capacity confirmed at the site', action: 'Get will-serve letters for water, sewer, and power, and price any extension or off-site upgrade.', fromForm: (form) => form.utilityStatus === 'available' },
  { key: 'landAccess', label: 'Legal access confirmed', action: 'Confirm recorded frontage or an easement, curb cuts, and emergency access with title and the road authority.', fromForm: (form) => form.accessStatus === 'legal_confirmed' },
  { key: 'landEnvironmental', label: 'Environmental review clear', action: 'Complete a Phase I review, and a Phase II if it is indicated, and price any remediation.', fromForm: (form) => form.environmentalStatus === 'clear' },
  { key: 'landGeotechnical', label: 'Geotechnical report complete and suitable', action: 'Commission borings and a geotechnical report; price any rock, groundwater, slope, or foundation measures.', fromForm: (form) => form.geotechnicalStatus === 'complete_suitable' },
  { key: 'landFloodZone', label: 'FEMA flood zone looked up', action: 'Look up the FEMA designation and base flood elevation, and get an insurance indication if one is required.', fromForm: (form) => floodZoneVerified(form.floodZone) },
  { key: 'landTitleSurveyVerified', label: 'Title, survey, easements, and boundaries reviewed', action: 'Review the title commitment and a current survey for easements, encroachments, liens, and restrictions.' },
  { key: 'landExitValueVerified', label: 'Exit value supported by comparable sales or a signed offer', action: 'Support the terminal value with recent comparable sales, a broker opinion, or a signed purchase agreement.' },
  { key: 'landBudgetVerified', label: 'Construction budget backed by contractor bids', action: 'Replace allowances with written bids for site work and construction, and confirm the contingency.' },
  { key: 'landLenderVerified', label: 'Construction lender term sheet confirmed', action: 'Confirm loan-to-cost, rate, fees, interest reserve, draw schedule, recourse, and maturity in a term sheet.' },
];

// The items the visitor ticks; the rest follow the form.
export const LAND_CHECKLIST_ITEMS = LAND_EVIDENCE_ITEMS.filter((item) => !item.fromForm);

const LAND_COST_FIELDS = ['siteWorkCost', 'hardConstructionCost', 'softCosts', 'permitsImpactFees', 'environmentalRemediation', 'developerFee'];
const usd = (value) => Math.round(value).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const pct = (value) => `${Number((value * 100).toFixed(2))}%`;

const scaleLandCosts = (form, multiplier) => Object.fromEntries(LAND_COST_FIELDS.map((field) => [field, String(n(form[field]) * multiplier)]));
// Scale whichever input sets the terminal value, as the simulation does.
const scaleTerminalValue = (form, multiplier) => n(form.expectedTerminalValue) > 0
  ? { expectedTerminalValue: String(n(form.expectedTerminalValue) * multiplier) }
  : { stabilizedNoi: String(n(form.stabilizedNoi) * multiplier) };

const landMetrics = (analysis) => ({
  profit: metricValue(analysis, 'development_profit'),
  margin: metricValue(analysis, 'development_margin'),
  roi: metricValue(analysis, 'development_roi'),
  irr: metricValue(analysis, 'irr'),
});

const buildLandScenario = (form, name, changes) => ({ name, assumptions: changes, metrics: landMetrics(analyzeForm({ ...form, ...changes })) });

// In the two stressed cases the cost figures are the outcome, so the change
// replaces the contingency reserve on site work and hard construction rather
// than being added on top of it, as in the simulation. A 10% rise with a 10%
// contingency is therefore the base case's cost, not 1.1 x 1.1 = 21% over.
const buildLandScenarios = (form) => [
  buildLandScenario(form, 'Downside', {
    ...scaleTerminalValue(form, 0.9),
    ...scaleLandCosts(form, 1.1),
    landContingency: '0',
    holdMonths: String(n(form.holdMonths) + 6),
    interestRate: String(n(form.interestRate) + 0.5),
  }),
  buildLandScenario(form, 'Base', {}),
  buildLandScenario(form, 'Upside', {
    ...scaleTerminalValue(form, 1.05),
    ...scaleLandCosts(form, 0.95),
    landContingency: '0',
    interestRate: String(Math.max(0, n(form.interestRate) - 0.25)),
  }),
];

export const LAND_SCENARIO_NOTE = 'Downside: exit value 10% lower, development costs 10% higher (the rise replaces the contingency), six months longer, interest 0.5 points higher. Upside: exit value 5% higher, costs 5% lower with the contingency unspent, interest 0.25 points lower.';

// Other costs stay as entered; the facility is resized to the same share of cost.
const landAtPrice = (form, purchasePrice) => analyzeForm({ ...form, purchasePrice: String(purchasePrice) });

export const buildLandDecision = ({ form, evidence = {} }) => {
  if (form.strategy !== 'land') return null;
  const base = analyzeForm(form);
  const now = landMetrics(base);
  const askingPrice = n(form.purchasePrice);
  const terminalValue = finite(base.metrics?.development_profit?.components?.terminal_value) || 0;
  const breakEvenTerminalValue = metricValue(base, 'break_even_terminal_value');
  const targets = { margin: n(form.targetProfitMargin) / 100, irr: n(form.targetIrr) / 100 };

  const residual = metricValue(base, 'residual_land_value');
  const ceilings = [
    { key: 'margin', label: targets.margin > 0 ? `${n(form.targetProfitMargin)}% development margin` : 'Break-even (no margin target)', value: residual, source: 'Residual land value' },
  ];
  if (targets.irr > 0) ceilings.push({ key: 'irr', label: `${n(form.targetIrr)}% levered IRR`, value: findPriceCeiling({ form, metricKey: 'irr', target: targets.irr, analyzeAt: landAtPrice }), source: 'Return hurdle' });
  if (n(form.preliminaryMarketCeiling) > 0) ceilings.push({ key: 'market', label: 'Comparable land value', value: n(form.preliminaryMarketCeiling), source: 'Entered by you' });

  // Every ceiling must be met, so the lowest one controls. One that cannot be
  // met at any price means there is no workable price at all.
  const workable = terminalValue > 0 && ceilings.every((item) => item.value !== null && item.value > 0);
  const exactMaximum = workable ? Math.min(...ceilings.map((item) => item.value)) : null;
  const increment = exactMaximum !== null && exactMaximum < 250000 ? 1000 : 5000;
  const recommendedMaximum = exactMaximum === null ? null : roundDown(exactMaximum, increment);
  const hasRecommendedMaximum = recommendedMaximum !== null && recommendedMaximum > 0;
  const bindingKey = exactMaximum === null ? null : ceilings.find((item) => item.value === exactMaximum)?.key;

  const hurdleResults = [
    { label: 'Development margin', actual: now.margin, target: targets.margin, pass: now.margin !== null && now.margin >= targets.margin, format: 'rate' },
  ];
  if (targets.irr > 0) hurdleResults.push({ label: 'Levered IRR', actual: now.irr, target: targets.irr, pass: now.irr !== null && now.irr >= targets.irr, format: 'rate' });

  const items = LAND_EVIDENCE_ITEMS.map((item) => ({ ...item, verified: item.fromForm ? item.fromForm(form) : Boolean(evidence[item.key]) }));
  const verified = items.filter((item) => item.verified);
  const gaps = items.filter((item) => !item.verified).map(({ key, label, action }) => ({ key, label, action }));
  const confidence = verified.length >= 8 ? 'High' : verified.length >= 5 ? 'Medium' : 'Low';

  const scenarios = buildLandScenarios(form);
  const downside = scenarios[0].metrics;
  const flood = classifyFloodZone(form.floodZone);
  const scheduleMonths = n(form.developmentMonths) + n(form.absorptionMonths);

  // Conditions that stop the deal whatever the price.
  const stoppers = [];
  if (form.accessStatus === 'access_unavailable') stoppers.push('There is no confirmed legal access to the site.');
  if (form.utilityStatus === 'unavailable') stoppers.push('Utilities are unavailable at the site.');
  // Conditions to resolve before going ahead.
  const cautions = [];
  if (downside.profit !== null && downside.profit < 0) cautions.push(`The downside case loses ${usd(Math.abs(downside.profit))}.`);
  if (scheduleMonths > n(form.holdMonths)) cautions.push(`Development plus absorption is ${scheduleMonths} months, longer than the ${n(form.holdMonths)}-month hold, so carrying costs and interest are understated.`);
  if (form.environmentalStatus === 'remediation_required' && !(n(form.environmentalRemediation) > 0)) cautions.push('Remediation is required but no remediation cost is entered.');
  if (flood.status === 'special') cautions.push(`Flood zone ${flood.zone} is a FEMA Special Flood Hazard Area.`);
  if (n(form.wetlandsAcres) > 0) cautions.push('Wetlands are on the site; the buildable area and permits need confirming.');
  const walkAwaySignals = [...stoppers, ...cautions];

  const meetsTargets = exactMaximum !== null && askingPrice <= exactMaximum && hurdleResults.every((item) => item.pass);
  let call = 'NO-GO'; let verdict; let tone = 'red';
  if (!(terminalValue > 0)) verdict = 'NO-GO — NO EXIT VALUE ENTERED';
  else if (stoppers.length) verdict = 'NO-GO — SITE CONDITION';
  else if (now.profit !== null && now.profit <= 0) verdict = 'NO-GO — THE DEAL LOSES MONEY';
  else if (exactMaximum === null) verdict = 'NO-GO — NO LAND PRICE MEETS YOUR TARGETS';
  else if (askingPrice > exactMaximum * 1.05) verdict = 'NO-GO AT THIS PRICE — REPRICE OR PASS';
  else if (!meetsTargets) { call = 'NEGOTIATE'; verdict = 'NEGOTIATE — WITHIN 5% OF THE CEILING'; tone = 'amber'; }
  else if (cautions.length) { call = 'CONDITIONAL GO'; verdict = 'CONDITIONAL GO — RESOLVE EXCEPTIONS'; tone = 'amber'; }
  else if (gaps.length) { call = 'CONDITIONAL GO'; verdict = 'CONDITIONAL GO — VERIFY BEFORE CLOSING'; tone = 'amber'; }
  else { call = 'GO'; verdict = 'GO — MEETS YOUR TARGETS'; tone = 'green'; }

  const gapToAsk = recommendedMaximum === null ? null : askingPrice - recommendedMaximum;
  const earns = now.profit === null ? 'cannot be valued'
    : now.profit >= 0 ? `is modeled to earn ${usd(now.profit)}${now.margin === null ? '' : ` (${pct(now.margin)} of exit value)`}`
      : `is modeled to lose ${usd(Math.abs(now.profit))}`;
  const missed = hurdleResults.filter((item) => !item.pass).map((item) => (item.label === 'Levered IRR'
    ? `your ${n(form.targetIrr)}% IRR target`
    : targets.margin > 0 ? `your ${n(form.targetProfitMargin)}% margin target` : 'break-even'));
  const marketCeiling = ceilings.find((item) => item.key === 'market');
  if (marketCeiling && askingPrice > marketCeiling.value) missed.push('the comparable land value you entered');
  const missedText = missed.length ? missed.join(' and ') : 'your targets';
  let summary;
  if (!(terminalValue > 0)) summary = 'Enter an expected gross exit value, or a stabilized NOI with an exit cap rate, so profit can be measured.';
  else if (stoppers.length) summary = `${stoppers.join(' ')} Resolve this before pricing the land. At ${usd(askingPrice)} the deal ${earns}.`;
  else if (exactMaximum === null) summary = `At ${usd(askingPrice)} the deal ${earns}. With the costs and exit value entered, no land price meets your targets.`;
  else if (meetsTargets) summary = `At ${usd(askingPrice)} the deal ${earns}, which meets your targets. The highest land price that still meets them is ${usd(exactMaximum)}.`;
  else summary = `At ${usd(askingPrice)} the deal ${earns}, short of ${missedText}. The highest land price that meets your targets is ${usd(exactMaximum)}, which is ${usd(askingPrice - exactMaximum)} below this price.`;

  return {
    version: DECISION_VERSION,
    strategy: 'land',
    call,
    verdict,
    tone,
    confidence,
    evidenceVerified: verified.length,
    evidenceTotal: items.length,
    evidenceGaps: gaps,
    hurdleResults,
    ceilings: ceilings.map((item) => ({ ...item, binding: item.key === bindingKey })),
    exactMaximum,
    recommendedMaximum,
    askingPrice,
    gapToAsk,
    // Shown only when the price has to come down to reach the ceiling.
    openingRange: hasRecommendedMaximum && askingPrice > recommendedMaximum ? [roundNearest(recommendedMaximum * 0.92, increment), roundNearest(recommendedMaximum * 0.97, increment)] : null,
    profitability: {
      profit: now.profit, margin: now.margin, targetMargin: targets.margin, roi: now.roi, irr: now.irr,
      terminalValue, breakEvenTerminalValue,
      // How far the exit value can fall before the deal stops making money.
      cushion: terminalValue > 0 && breakEvenTerminalValue !== null ? (terminalValue - breakEvenTerminalValue) / terminalValue : null,
    },
    scenarios,
    scenarioNote: LAND_SCENARIO_NOTE,
    walkAwaySignals,
    summary,
    valuationNotice: 'This is the most the land is worth to this plan at the figures entered. It is not an appraisal, a broker price opinion, or a statement of market value.',
  };
};

// ---------------------------------------------------------------------------
// Fix and flip: Go / No-Go and the highest price that meets the targets
// (item 3 of the 2026-10-22 review of the Fix & flip tab).
//
// Two targets, both entered by the visitor: a minimum profit in dollars and a
// minimum return on cash (flip ROI). For each, the page finds by repeated
// calculation the highest purchase price at which the target is still met;
// other costs stay as entered and the loan stays the same share of the price.
// The lowest ceiling controls. The 70% rule figure is shown beside them as a
// screen, never as a target.
export const FLIP_EVIDENCE_ITEMS = [
  { key: 'flipArvVerified', label: 'After-repair value supported by sold comparables of the same kind of house', action: 'Use recent sales of renovated houses of similar size, age, type and setting; a comparable of a different kind of property does not price this one.' },
  { key: 'flipBudgetVerified', label: 'Rehab budget backed by a contractor walk-through and written bids', action: 'Walk the property with a contractor and replace allowances with written bids; confirm the contingency against what is still unknown.' },
  { key: 'flipInspectionVerified', label: 'Inspection complete, including roof, structure, HVAC, electrical, plumbing, and septic or well where they apply', action: 'Order the inspections before the diligence period ends, and price every defect found into the budget or the offer.' },
  { key: 'flipHoldingVerified', label: 'Holding costs priced: taxes, insurance, utilities', action: 'Confirm the tax bill, get a quote for vacant-property or builder\'s-risk insurance, and estimate utilities for the hold.' },
  { key: 'flipLenderVerified', label: 'Lender term sheet confirmed', action: 'Confirm the advance on the price and on the rehab, points, rate, draw schedule, term, and extension fees in a term sheet.' },
  { key: 'flipTitleVerified', label: 'Title, survey, access, and liens reviewed', action: 'Review the title commitment and survey for easements, encroachments, liens, open permits, and recorded restrictions.' },
  { key: 'flipExitVerified', label: 'Exit plan and selling costs confirmed', action: 'Confirm the listing terms, the selling costs, and the days on market for renovated houses in this area.' },
];

const flipMetrics = (analysis) => {
  const profit = metricValue(analysis, 'flip_profit');
  const salePrice = finite(analysis.metrics?.flip_profit?.components?.sale_price) || 0;
  return {
    profit,
    roi: metricValue(analysis, 'flip_roi'),
    margin: profit !== null && salePrice > 0 ? profit / salePrice : null,
    irr: metricValue(analysis, 'irr'),
    equityMultiple: metricValue(analysis, 'equity_multiple'),
  };
};

// The loan stays at its base amount in the stressed cases: a lender sizes it
// once, on the underwritten figures, not on a lower exit or a bigger budget,
// and never lends more than the case's project cost.
const buildFlipScenario = (form, name, changes) => {
  const base = pinLoans(buildDealRequest(form));
  const request = capPinnedLoans({ ...buildDealRequest({ ...form, ...changes }), debt: base.debt });
  return { name, assumptions: changes, metrics: flipMetrics(analyzeDealLocally(request)) };
};

// In the two stressed cases the rehab figure is the outcome, so it replaces
// the contingency reserve rather than being added on top of it, as in the
// simulation.
const buildFlipScenarios = (form) => [
  buildFlipScenario(form, 'Downside', {
    arv: String(n(form.arv) * 0.9),
    rehabCost: String(Math.round(n(form.rehabCost) * 115) / 100),
    rehabContingency: '0',
    holdMonths: String(n(form.holdMonths) + 3),
  }),
  buildFlipScenario(form, 'Base', {}),
  buildFlipScenario(form, 'Upside', {
    arv: String(n(form.arv) * 1.05),
    rehabContingency: '0',
  }),
];

export const FLIP_SCENARIO_NOTE = 'Downside: after-repair value 10% lower, rehab 15% over budget (the overrun replaces the contingency), three months longer. Upside: after-repair value 5% higher, rehab on budget with the contingency unspent.';

// The after-repair value can fall this far before the deal loses money.
const FLIP_THIN_CUSHION = 0.10;

// Other costs stay as entered; the loan is resized to the same share of the price.
const flipAtPrice = (form, purchasePrice) => analyzeForm({ ...form, purchasePrice: String(purchasePrice) });

export const buildFlipDecision = ({ form, evidence = {}, today = new Date() }) => {
  if (form.strategy !== 'flip') return null;
  const base = analyzeForm(form);
  const now = flipMetrics(base);
  const askingPrice = n(form.purchasePrice);
  const arv = n(form.arv);
  const sellingCostRate = n(form.sellingCosts) / 100;
  const rule70 = metricValue(base, 'max_offer_70_rule');
  const targets = { profit: Math.max(0, n(form.flipMinimumProfit)), roi: n(form.flipTargetRoi) / 100 };

  const ceilings = [
    { key: 'profit', label: targets.profit > 0 ? `${usd(targets.profit)} minimum profit` : 'Break-even (no minimum profit)', value: findPriceCeiling({ form, metricKey: 'flip_profit', target: targets.profit, analyzeAt: flipAtPrice, allowZeroTarget: true }), source: 'Profit hurdle' },
  ];
  if (targets.roi > 0) ceilings.push({ key: 'roi', label: `${n(form.flipTargetRoi)}% return on cash`, value: findPriceCeiling({ form, metricKey: 'flip_roi', target: targets.roi, analyzeAt: flipAtPrice }), source: 'Return hurdle' });
  // A screen, shown for comparison. It never sets the maximum.
  ceilings.push({ key: 'rule70', label: '70% rule screening figure', value: rule70, source: '70% of after-repair value less rehab and contingency; a screen, not a target', screen: true });

  const targetCeilings = ceilings.filter((item) => !item.screen);
  const workable = arv > 0 && targetCeilings.every((item) => item.value !== null && item.value > 0);
  const exactMaximum = workable ? Math.min(...targetCeilings.map((item) => item.value)) : null;
  const increment = exactMaximum !== null && exactMaximum < 250000 ? 1000 : 5000;
  const recommendedMaximum = exactMaximum === null ? null : roundDown(exactMaximum, increment);
  const hasRecommendedMaximum = recommendedMaximum !== null && recommendedMaximum > 0;
  const bindingKey = exactMaximum === null ? null : targetCeilings.find((item) => item.value === exactMaximum)?.key;

  const hurdleResults = [
    { label: 'Profit', actual: now.profit, target: targets.profit, pass: now.profit !== null && now.profit >= targets.profit, format: 'money' },
  ];
  if (targets.roi > 0) hurdleResults.push({ label: 'Return on cash', actual: now.roi, target: targets.roi, pass: now.roi !== null && now.roi >= targets.roi, format: 'rate' });

  const items = FLIP_EVIDENCE_ITEMS.map((item) => ({ ...item, verified: Boolean(evidence[item.key]) }));
  const verified = items.filter((item) => item.verified);
  const gaps = items.filter((item) => !item.verified).map(({ key, label, action }) => ({ key, label, action }));
  const confidence = verified.length >= 6 ? 'High' : verified.length >= 3 ? 'Medium' : 'Low';

  const scenarios = buildFlipScenarios(form);
  const downside = scenarios[0].metrics;
  // Profit moves one for one with net sale proceeds, so the break-even
  // after-repair value and the room above it follow from the profit.
  const breakEvenArv = now.profit !== null && sellingCostRate < 1 ? arv - now.profit / (1 - sellingCostRate) : null;
  const cushion = arv > 0 && breakEvenArv !== null ? (arv - breakEvenArv) / arv : null;
  // Rehab is paid from equity dollar for dollar, so this is the further
  // overrun, beyond the contingency, that uses up the profit.
  const rehabCushion = now.profit !== null && n(form.rehabCost) > 0 ? now.profit / n(form.rehabCost) : null;
  const loanTermMonths = n(form.ltv) > 0 ? n(form.loanTermYears) * 12 : null;

  // Conditions to resolve before going ahead.
  const cautions = [];
  if (downside.profit !== null && downside.profit < 0) cautions.push(`The downside case loses ${usd(Math.abs(downside.profit))}.`);
  if (rule70 !== null && askingPrice > rule70) cautions.push(`The price is ${usd(askingPrice - rule70)} above the 70% rule screening figure of ${usd(rule70)}. The rule is a screen, not a valuation; it says the margin is thin for the work involved, so the after-repair value and the budget must hold.`);
  if (cushion !== null && now.profit > 0 && cushion < FLIP_THIN_CUSHION) cautions.push(`The after-repair value can fall only ${pct(cushion)} before the deal loses money.`);
  if (loanTermMonths !== null && n(form.holdMonths) > loanTermMonths) cautions.push(`The ${n(form.holdMonths)}-month hold is longer than the ${loanTermMonths}-month loan term, so the loan comes due before the sale.`);
  // Items 2, 7 and 8: what the listing history and the seller's posture
  // usually mean, the after-repair value per square foot, and the holding
  // costs against their parts. Each caution is an exception to resolve.
  const listing = buildListingSignals(form, { now: today });
  const sanity = arvChecks(form);
  const parts = holdingCostParts(form);
  const holding = n(form.monthlyHolding);
  if (!(holding > 0)) cautions.push('No monthly holding costs are entered; taxes, insurance and utilities run for every month of the hold.');
  else if (parts.entered && parts.total > 0 && Math.abs(holding - parts.total) > Math.max(parts.total * 0.10, 25)) cautions.push(`Monthly holding costs are entered as ${usd(holding)}, but taxes, insurance and utilities add up to ${usd(parts.total)} a month.`);
  cautions.push(...listing.cautions, ...sanity.cautions);
  const walkAwaySignals = [...cautions];

  const meetsTargets = exactMaximum !== null && askingPrice <= exactMaximum && hurdleResults.every((item) => item.pass);
  let call = 'NO-GO'; let verdict; let tone = 'red';
  if (!(arv > 0)) verdict = 'NO-GO — NO AFTER-REPAIR VALUE ENTERED';
  else if (now.profit !== null && now.profit <= 0) verdict = 'NO-GO — THE DEAL LOSES MONEY';
  else if (exactMaximum === null) verdict = 'NO-GO — NO PRICE MEETS YOUR TARGETS';
  else if (askingPrice > exactMaximum * 1.05) verdict = 'NO-GO AT THIS PRICE — REPRICE OR PASS';
  else if (!meetsTargets) { call = 'NEGOTIATE'; verdict = 'NEGOTIATE — WITHIN 5% OF THE CEILING'; tone = 'amber'; }
  else if (cautions.length) { call = 'CONDITIONAL GO'; verdict = 'CONDITIONAL GO — RESOLVE EXCEPTIONS'; tone = 'amber'; }
  else if (gaps.length) { call = 'CONDITIONAL GO'; verdict = 'CONDITIONAL GO — VERIFY BEFORE CLOSING'; tone = 'amber'; }
  else { call = 'GO'; verdict = 'GO — MEETS YOUR TARGETS'; tone = 'green'; }

  const gapToAsk = recommendedMaximum === null ? null : askingPrice - recommendedMaximum;
  const earns = now.profit === null ? 'cannot be valued'
    : now.profit >= 0 ? `is modeled to earn ${usd(now.profit)}${now.roi === null ? '' : ` (${pct(now.roi)} on cash)`}`
      : `is modeled to lose ${usd(Math.abs(now.profit))}`;
  const missed = hurdleResults.filter((item) => !item.pass).map((item) => (item.label === 'Return on cash'
    ? `your ${n(form.flipTargetRoi)}% return on cash`
    : targets.profit > 0 ? `your ${usd(targets.profit)} minimum profit` : 'break-even'));
  const missedText = missed.length ? missed.join(' and ') : 'your targets';
  let summary;
  if (!(arv > 0)) summary = 'Enter an after-repair value so profit can be measured.';
  else if (exactMaximum === null) summary = `At ${usd(askingPrice)} the deal ${earns}. With the after-repair value and costs entered, no price meets your targets.`;
  else if (meetsTargets) summary = `At ${usd(askingPrice)} the deal ${earns}, which meets your targets. The highest price that still meets them is ${usd(exactMaximum)}.`;
  else summary = `At ${usd(askingPrice)} the deal ${earns}, short of ${missedText}. The highest price that meets your targets is ${usd(exactMaximum)}, which is ${usd(askingPrice - exactMaximum)} below this price.`;

  return {
    version: DECISION_VERSION,
    strategy: 'flip',
    call,
    verdict,
    tone,
    confidence,
    evidenceVerified: verified.length,
    evidenceTotal: items.length,
    evidenceGaps: gaps,
    hurdleResults,
    ceilings: ceilings.map((item) => ({ ...item, binding: item.key === bindingKey })),
    exactMaximum,
    recommendedMaximum,
    askingPrice,
    gapToAsk,
    // Shown only when the price has to come down to reach the ceiling.
    openingRange: hasRecommendedMaximum && askingPrice > recommendedMaximum ? [roundNearest(recommendedMaximum * 0.92, increment), roundNearest(recommendedMaximum * 0.97, increment)] : null,
    profitability: {
      profit: now.profit, roi: now.roi, margin: now.margin, irr: now.irr, equityMultiple: now.equityMultiple,
      targetProfit: targets.profit, targetRoi: targets.roi,
      arv, breakEvenArv, cushion, rehabCushion, rule70,
    },
    scenarios,
    scenarioNote: FLIP_SCENARIO_NOTE,
    walkAwaySignals,
    // Facts and notes for the page; the cautions are already in walkAwaySignals.
    intelligence: {
      facts: [...listing.facts, ...sanity.facts, ...(parts.entered ? [{ key: 'holdingParts', label: 'Holding costs from their parts', value: `${usd(parts.total)}/month`, detail: `taxes ${usd(parts.taxes)}, insurance ${usd(parts.insurance)}, utilities ${usd(parts.utilities)} a month; ${usd(holding)} entered` }] : [])],
      notes: [...listing.signals, ...sanity.signals].filter((signal) => signal.level === 'note').map((signal) => signal.text),
    },
    summary,
    valuationNotice: 'This is the most the house is worth to this plan at the figures entered. It is not an appraisal, a broker price opinion, or a statement of market value.',
  };
};

// One entry point for the page: the decision for whichever strategy has one.
export const buildDecision = ({ form, evidence = {} }) => (
  form.strategy === 'rental' ? buildRentalDecision({ form, evidence })
    : form.strategy === 'land' ? buildLandDecision({ form, evidence })
      : form.strategy === 'flip' ? buildFlipDecision({ form, evidence })
        : null
);
