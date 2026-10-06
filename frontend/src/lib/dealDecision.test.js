import { buildDecision, buildLandDecision, buildRentalDecision, LAND_CHECKLIST_ITEMS, LAND_EVIDENCE_ITEMS } from './dealDecision';
import { analyzeDealLocally } from './dealAnalysis';
import { buildDealRequest } from './dealRequest';

const oakStreetForm = {
  strategy: 'rental', propertyType: 'multifamily', market: 'Atlanta, GA', units: '2', rentableSquareFeet: '2820',
  purchasePrice: '500000', closingCosts: '15000', dueDiligenceCosts: '0', initialCapex: '15000', holdMonths: '60',
  ltv: '75', interestRate: '7.25', amortizationYears: '30', interestOnlyMonths: '0', loanTermYears: '10', originationFee: '0',
  annualRent: '52800', otherIncome: '0', vacancy: '5', propertyTaxes: '6500', insurance: '4000', repairsMaintenance: '3009.6',
  utilities: '0', payrollAdmin: '1500', managementFee: '8', reserves: '2508', annualBelowNoiCosts: '0', incomeGrowth: '3',
  expenseGrowth: '3', exitCap: '6.5', explicitSalePrice: '', sellingCosts: '6', discountRate: '10',
  targetCashOnCash: '8', minimumDscr: '1.2', targetIrr: '15', preliminaryMarketCeiling: '',
  maxImmediateCapex: '25000', maxAnnualTaxes: '7000', maxAnnualInsurance: '5000',
};

test('creates an investment-committee maximum offer and verdict', () => {
  const decision = buildRentalDecision({ form: oakStreetForm, evidence: {} });
  expect(decision.recommendedMaximum).toBeGreaterThanOrEqual(315000);
  expect(decision.recommendedMaximum).toBeLessThanOrEqual(335000);
  expect(decision.verdict).toBe('REPRICE OR PASS');
  expect(decision.gapToAsk).toBeGreaterThan(150000);
  expect(decision.ceilings.find((item) => item.binding)?.key).toBe('cashOnCash');
});

test('downside is weaker than base and evidence drives confidence', () => {
  const evidence = {
    rentRollVerified: true, legalUseVerified: true, inspectionVerified: true,
    taxVerified: true, insuranceVerified: true, lenderTermsVerified: true,
  };
  const decision = buildRentalDecision({ form: oakStreetForm, evidence });
  const downside = decision.scenarios.find((item) => item.name === 'Downside');
  const base = decision.scenarios.find((item) => item.name === 'Base');
  expect(downside.metrics.cashOnCash).toBeLessThan(base.metrics.cashOnCash);
  expect(downside.metrics.dscr).toBeLessThan(base.metrics.dscr);
  expect(decision.confidence).toBe('High');
});

test('preserves an explicit terminal value while solving the maximum offer', () => {
  const decision = buildRentalDecision({
    form: { ...oakStreetForm, exitCap: '', explicitSalePrice: '420000' },
    evidence: {},
  });
  const irrCeiling = decision.ceilings.find((item) => item.key === 'irr');

  expect(irrCeiling.value).toBeGreaterThan(300000);
  expect(decision.recommendedMaximum).toBe(325000);
  expect(decision.verdict).toBe('REPRICE OR PASS');
  expect(decision.openingRange).toEqual([300000, 315000]);
});

test('stresses an explicit terminal value instead of an ignored exit cap', () => {
  const decision = buildRentalDecision({
    form: { ...oakStreetForm, exitCap: '', explicitSalePrice: '420000' },
    evidence: {},
  });
  const downside = decision.scenarios.find((item) => item.name === 'Downside');
  const base = decision.scenarios.find((item) => item.name === 'Base');
  const upside = decision.scenarios.find((item) => item.name === 'Upside');

  expect(downside.assumptions.explicitSalePrice).toBe('378000');
  expect(downside.assumptions.exitCap).toBeUndefined();
  expect(downside.metrics.salePrice).toBe(378000);
  expect(base.metrics.salePrice).toBe(420000);
  expect(upside.metrics.salePrice).toBeCloseTo(462000, 6);
});

test('treats a rounded zero maximum as a binding walk-away decision', () => {
  const decision = buildRentalDecision({
    form: { ...oakStreetForm, preliminaryMarketCeiling: '3804' },
    evidence: {},
  });

  expect(decision.exactMaximum).toBe(3804);
  expect(decision.recommendedMaximum).toBe(0);
  expect(decision.verdict).toBe('REPRICE OR PASS');
  expect(decision.tone).toBe('red');
  expect(decision.summary).toContain('exceeds the return-constrained ceiling');
});

// ---------------------------------------------------------------------------
// DE-25: land development Go / No-Go.
const landForm = {
  address: '', strategy: 'land', propertyType: 'land', market: 'Atlanta, GA', units: '4', rentableSquareFeet: '12000',
  purchasePrice: '985000', closingCosts: '20000', dueDiligenceCosts: '15000', initialCapex: '0', holdMonths: '24',
  ltv: '65', interestRate: '6.75', amortizationYears: '30', interestOnlyMonths: '24', loanTermYears: '2', originationFee: '1',
  sellingCosts: '6', discountRate: '10', targetIrr: '15', preliminaryMarketCeiling: '',
  developmentType: 'single_family_subdivision', dispositionStrategy: 'build_and_sell', siteAcres: '2.5', parcelCount: '1',
  currentZoning: '', proposedZoning: '', entitlementStatus: 'unentitled', utilityStatus: 'verify', accessStatus: 'verify',
  environmentalStatus: 'phase_i_required', geotechnicalStatus: 'not_started', floodZone: 'Not verified', wetlandsAcres: '0',
  developmentMonths: '18', absorptionMonths: '6', siteWorkCost: '250000', hardConstructionCost: '1400000', softCosts: '150000',
  permitsImpactFees: '60000', environmentalRemediation: '0', developerFee: '80000', landContingency: '10',
  annualCarryingCosts: '24000', expectedTerminalValue: '4300000', stabilizedNoi: '0', stabilizedExitCap: '0', targetProfitMargin: '20',
};
const verifiedSite = { entitlementStatus: 'fully_entitled', utilityStatus: 'available', accessStatus: 'legal_confirmed', environmentalStatus: 'clear', geotechnicalStatus: 'complete_suitable', floodZone: 'X' };
const allTicked = Object.fromEntries(LAND_CHECKLIST_ITEMS.map((item) => [item.key, true]));
const land = (changes = {}, evidence = {}) => buildLandDecision({ form: { ...landForm, ...changes }, evidence });

test('a land deal priced above its ceiling is a No-Go with the price that would work', () => {
  const decision = land();
  expect(decision.strategy).toBe('land');
  expect(decision.call).toBe('NO-GO');
  expect(decision.verdict).toBe('NO-GO AT THIS PRICE — REPRICE OR PASS');
  expect(decision.tone).toBe('red');
  expect(decision.exactMaximum).toBeCloseTo(724062.14, 1);
  expect(decision.recommendedMaximum).toBe(720000);
  expect(decision.gapToAsk).toBe(265000);
  expect(decision.openingRange).toEqual([660000, 700000]);
  expect(decision.ceilings.find((item) => item.binding).key).toBe('margin');
  expect(decision.summary).toBe('At $985,000 the deal is modeled to earn $574,469 (13.36% of exit value), short of your 20% margin target. The highest land price that meets your targets is $724,062, which is $260,938 below this price.');
  // Only the target that is missed is named: the IRR target is met here.
  expect(decision.hurdleResults.map((item) => [item.label, item.pass])).toEqual([['Development margin', false], ['Levered IRR', true]]);
});

test('the margin ceiling is the residual land value, so the decision and the metric cannot disagree', () => {
  const analysis = analyzeDealLocally(buildDealRequest(landForm));
  const decision = land();
  expect(decision.ceilings.find((item) => item.key === 'margin').value).toBe(analysis.metrics.residual_land_value.value);
  expect(decision.profitability.profit).toBe(analysis.metrics.development_profit.value);
  expect(decision.profitability.margin).toBe(analysis.metrics.development_margin.value);
});

test('within 5% above the ceiling the call is to negotiate', () => {
  const decision = land({ purchasePrice: '740000' });
  expect(decision.call).toBe('NEGOTIATE');
  expect(decision.verdict).toBe('NEGOTIATE — WITHIN 5% OF THE CEILING');
  expect(decision.tone).toBe('amber');
  expect(decision.gapToAsk).toBe(20000);
});

test('a price that meets the targets is a conditional Go until the diligence is verified', () => {
  const decision = land({ purchasePrice: '700000' });
  expect(decision.call).toBe('CONDITIONAL GO');
  expect(decision.verdict).toBe('CONDITIONAL GO — VERIFY BEFORE CLOSING');
  expect(decision.confidence).toBe('Low');
  expect(decision.evidenceVerified).toBe(0);
  expect(decision.evidenceTotal).toBe(10);
  expect(decision.evidenceGaps).toHaveLength(10);
  expect(decision.openingRange).toBeNull(); // already at or below the ceiling
  expect(decision.summary).toContain('which meets your targets');
  expect(decision.gapToAsk).toBe(-20000);
});

test('targets met and all ten diligence items verified is a Go', () => {
  const decision = land({ purchasePrice: '650000', ...verifiedSite }, allTicked);
  expect(decision.call).toBe('GO');
  expect(decision.verdict).toBe('GO — MEETS YOUR TARGETS');
  expect(decision.tone).toBe('green');
  expect(decision.confidence).toBe('High');
  expect(decision.evidenceGaps).toEqual([]);
  expect(decision.walkAwaySignals).toEqual([]);
  expect(decision.hurdleResults.every((item) => item.pass)).toBe(true);
});

test('six evidence items follow the form and four are ticked by hand', () => {
  expect(LAND_EVIDENCE_ITEMS).toHaveLength(10);
  expect(LAND_CHECKLIST_ITEMS.map((item) => item.key)).toEqual(['landTitleSurveyVerified', 'landExitValueVerified', 'landBudgetVerified', 'landLenderVerified']);
  expect(land({ purchasePrice: '650000', ...verifiedSite }).evidenceVerified).toBe(6);
  expect(land({ purchasePrice: '650000' }, allTicked).evidenceVerified).toBe(4);
  // "Not verified" typed in the flood zone box is a gap, not a zone.
  expect(land({ ...verifiedSite, floodZone: 'Not verified' }).evidenceGaps.map((item) => item.key)).toContain('landFloodZone');
  expect(land({ ...verifiedSite, floodZone: 'AE' }).evidenceGaps.map((item) => item.key)).not.toContain('landFloodZone');
});

test('no legal access or no utilities stops the deal whatever the price', () => {
  for (const changes of [{ accessStatus: 'access_unavailable' }, { utilityStatus: 'unavailable' }]) {
    const decision = land({ purchasePrice: '650000', ...verifiedSite, ...changes }, allTicked);
    expect(decision.call).toBe('NO-GO');
    expect(decision.verdict).toBe('NO-GO — SITE CONDITION');
    expect(decision.walkAwaySignals).toHaveLength(1);
  }
});

test('a deal that loses money, or has no exit value, is a No-Go that says why', () => {
  const loss = land({ expectedTerminalValue: '2500000' });
  expect(loss.verdict).toBe('NO-GO — THE DEAL LOSES MONEY');
  expect(loss.exactMaximum).toBeNull();
  expect(loss.recommendedMaximum).toBeNull();
  expect(loss.summary).toContain('is modeled to lose $1,117,531');
  expect(loss.profitability.cushion).toBeLessThan(0);
  const none = land({ expectedTerminalValue: '0' });
  expect(none.verdict).toBe('NO-GO — NO EXIT VALUE ENTERED');
  expect(none.summary).toContain('Enter an expected gross exit value');
});

test('exceptions make a deal that meets its targets conditional', () => {
  const flood = land({ purchasePrice: '650000', ...verifiedSite, floodZone: 'AE' }, allTicked);
  expect(flood.verdict).toBe('CONDITIONAL GO — RESOLVE EXCEPTIONS');
  expect(flood.walkAwaySignals).toEqual(['Flood zone AE is a FEMA Special Flood Hazard Area.']);
  const slow = land({ purchasePrice: '650000', ...verifiedSite, developmentMonths: '24', absorptionMonths: '12' }, allTicked);
  expect(slow.walkAwaySignals[0]).toContain('36 months, longer than the 24-month hold');
  const thin = land({ purchasePrice: '700000', ...verifiedSite, expectedTerminalValue: '4000000', targetProfitMargin: '12', targetIrr: '' }, allTicked);
  expect(thin.scenarios[0].metrics.profit).toBeLessThan(0);
  expect(thin.walkAwaySignals.some((signal) => signal.startsWith('The downside case loses'))).toBe(true);
  expect(thin.call).toBe('CONDITIONAL GO');
});

test('the IRR target is optional, and a comparable land value caps the price', () => {
  const noIrr = land({ purchasePrice: '700000', targetIrr: '' });
  expect(noIrr.ceilings.map((item) => item.key)).toEqual(['margin']);
  expect(noIrr.hurdleResults.map((item) => item.label)).toEqual(['Development margin']);
  const capped = land({ purchasePrice: '700000', preliminaryMarketCeiling: '600000' });
  expect(capped.exactMaximum).toBe(600000);
  expect(capped.ceilings.find((item) => item.binding).key).toBe('market');
  expect(capped.call).toBe('NO-GO');
  expect(capped.summary).toContain('short of the comparable land value you entered');
});

test('downside, base and upside are ordered, and the cushion is the room above break-even', () => {
  const decision = land({ purchasePrice: '700000' });
  const [downside, base, upside] = decision.scenarios.map((scenario) => scenario.metrics.profit);
  expect(downside).toBeLessThan(base);
  expect(base).toBeLessThan(upside);
  const { terminalValue, breakEvenTerminalValue, cushion } = decision.profitability;
  expect(cushion).toBeCloseTo((terminalValue - breakEvenTerminalValue) / terminalValue, 12);
  expect(cushion).toBeGreaterThan(0);
});

test('the page asks one function for the decision, and fix and flip has none', () => {
  expect(buildDecision({ form: landForm }).strategy).toBe('land');
  expect(buildDecision({ form: oakStreetForm }).verdict).toBe('REPRICE OR PASS');
  expect(buildDecision({ form: { ...landForm, strategy: 'flip' } })).toBeNull();
  expect(buildLandDecision({ form: oakStreetForm })).toBeNull();
});
