import { buildDecision, buildFlipDecision, buildLandDecision, buildRentalDecision, DECISION_VERSION, FLIP_EVIDENCE_ITEMS, LAND_CHECKLIST_ITEMS, LAND_EVIDENCE_ITEMS } from './dealDecision';
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
  // Closing costs stay as entered at every price, as they do for flip and land.
  expect(decision.recommendedMaximum).toBe(320000);
  expect(decision.verdict).toBe('REPRICE OR PASS');
  expect(decision.openingRange).toEqual([295000, 310000]);
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
  expect(decision.exactMaximum).toBeCloseTo(831051.13, 1);
  expect(decision.recommendedMaximum).toBe(830000);
  expect(decision.gapToAsk).toBe(155000);
  expect(decision.openingRange).toEqual([765000, 805000]);
  expect(decision.ceilings.find((item) => item.binding).key).toBe('margin');
  expect(decision.summary).toBe('At $985,000 the deal is modeled to earn $693,172 (16.12% of exit value), short of your 20% margin target. The highest land price that meets your targets is $831,051, which is $153,949 below this price.');
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
  const decision = land({ purchasePrice: '850000' });
  expect(decision.call).toBe('NEGOTIATE');
  expect(decision.verdict).toBe('NEGOTIATE — WITHIN 5% OF THE CEILING');
  expect(decision.tone).toBe('amber');
  expect(decision.gapToAsk).toBe(20000);
});

test('a price that meets the targets is a conditional Go until the diligence is verified', () => {
  const decision = land({ purchasePrice: '810000' });
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
  expect(loss.summary).toContain('is modeled to lose $1,011,369');
  expect(loss.profitability.cushion).toBeLessThan(0);
  const none = land({ expectedTerminalValue: '0' });
  expect(none.verdict).toBe('NO-GO — NO EXIT VALUE ENTERED');
  expect(none.summary).toContain('Enter an expected gross exit value');
});

test('exceptions make a deal that meets its targets conditional', () => {
  const flood = land({ purchasePrice: '650000', ...verifiedSite, floodZone: 'AE' }, allTicked);
  expect(flood.verdict).toBe('CONDITIONAL GO — RESOLVE EXCEPTIONS');
  expect(flood.walkAwaySignals).toEqual(['Flood zone AE is a FEMA Special Flood Hazard Area.']);
  // A schedule longer than the hold is refused by the engine before any decision.
  expect(() => land({ purchasePrice: '650000', ...verifiedSite, developmentMonths: '24', absorptionMonths: '12' }, allTicked)).toThrow('The 24-month hold is shorter than the development schedule plus the absorption (24 + 12 months). Lengthen the hold or shorten the schedule.');
  // With the cost rise replacing the contingency the downside is milder than it
  // was, so the exit value sits lower to keep the downside case under water.
  const thin = land({ purchasePrice: '700000', ...verifiedSite, expectedTerminalValue: '3600000', targetProfitMargin: '8', targetIrr: '' }, allTicked);
  expect(thin.scenarios[0].metrics.profit).toBeLessThan(0);
  expect(thin.walkAwaySignals.some((signal) => signal.startsWith('The downside case loses'))).toBe(true);
  expect(thin.call).toBe('CONDITIONAL GO');
});

test('the stressed land cases replace the contingency instead of adding to it', () => {
  const decision = land();
  const [downside, base, upside] = decision.scenarios;
  const rounded = (assumptions) => Object.fromEntries(Object.entries(assumptions).map(([key, value]) => [key, Math.round(Number(value) * 100) / 100]));
  expect(rounded(downside.assumptions)).toEqual({
    expectedTerminalValue: 3870000, siteWorkCost: 275000, hardConstructionCost: 1540000, softCosts: 165000,
    permitsImpactFees: 66000, environmentalRemediation: 0, developerFee: 88000, landContingency: 0,
    holdMonths: 30, interestRate: 7.25,
  });
  expect(rounded(upside.assumptions)).toEqual({
    expectedTerminalValue: 4515000, siteWorkCost: 237500, hardConstructionCost: 1330000, softCosts: 142500,
    permitsImpactFees: 57000, environmentalRemediation: 0, developerFee: 76000, landContingency: 0,
    interestRate: 6.5,
  });
  expect(downside.metrics.profit).toBeLessThan(base.metrics.profit);
  expect(base.metrics.profit).toBeLessThan(upside.metrics.profit);
  // With the 10% contingency still applied, the downside used to charge
  // 1.1 x 1.1 = 21% over on site work and hard construction, and size the
  // loan, its fee and its interest on that larger cost.
  const compounded = buildLandDecision({ form: { ...landForm, ...downside.assumptions, landContingency: '10' }, evidence: {} }).scenarios[1].metrics.profit;
  expect(downside.metrics.profit).toBeGreaterThan(compounded + (275000 + 1540000) * 0.1 - 1);
  expect(decision.scenarioNote).toContain('the rise replaces the contingency');
  expect(decision.version).toBe(DECISION_VERSION);
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

test('the page asks one function for the decision, and every strategy has one', () => {
  expect(buildDecision({ form: landForm }).strategy).toBe('land');
  expect(buildDecision({ form: oakStreetForm }).verdict).toBe('REPRICE OR PASS');
  expect(buildDecision({ form: ruralFixerForm }).strategy).toBe('flip');
  expect(buildDecision({ form: { ...landForm, strategy: 'other' } })).toBeNull();
  expect(buildLandDecision({ form: oakStreetForm })).toBeNull();
  expect(buildFlipDecision({ form: oakStreetForm })).toBeNull();
});

// ---------------------------------------------------------------------------
// Fix and flip (item 3 of the 2026-10-22 review of the Fix & flip tab).
//
// A rural fixer: $93,000 price, hard-money loan at 70% / 11% / interest only /
// 2 points, $85,000 rehab with a 15% contingency, $250,000 after-repair value,
// seven-month hold. The base figures were checked by hand: profit $24,121,
// 16.83% on cash, 70% rule figure $77,250.
const ruralFixerForm = {
  strategy: 'flip', propertyType: 'single_family', market: '', units: '1', rentableSquareFeet: '1655',
  purchasePrice: '93000', closingCosts: '3000', dueDiligenceCosts: '2000', initialCapex: '0', holdMonths: '7',
  ltv: '70', interestRate: '11', amortizationYears: '30', interestOnlyMonths: '7', loanTermYears: '1', originationFee: '2',
  arv: '250000', rehabCost: '85000', rehabContingency: '15', monthlyHolding: '450', otherProjectCosts: '4000',
  sellingCosts: '7', discountRate: '10', flipMinimumProfit: '30000', flipTargetRoi: '20',
};
const flipAt = (changes) => buildFlipDecision({ form: { ...ruralFixerForm, ...changes }, evidence: {} });
const allFlipEvidence = Object.fromEntries(FLIP_EVIDENCE_ITEMS.map((item) => [item.key, true]));

test('a flip priced above its ceiling is a No-Go that names the price that would work', () => {
  const decision = flipAt({});
  expect(decision.call).toBe('NO-GO');
  expect(decision.verdict).toBe('NO-GO AT THIS PRICE — REPRICE OR PASS');
  expect(decision.tone).toBe('red');
  // Profit moves $1.0589 for every dollar of price (the dollar, 2 points on
  // 70% of it, and seven months' interest on it), so $30,000 needs the price
  // $5,553 lower: $87,447.
  expect(decision.exactMaximum).toBe(87447);
  expect(decision.recommendedMaximum).toBe(87000);
  expect(decision.ceilings.find((item) => item.binding).key).toBe('profit');
  expect(decision.ceilings.find((item) => item.key === 'roi').value).toBeGreaterThan(87447);
  expect(decision.summary).toBe('At $93,000 the deal is modeled to earn $24,121 (16.83% on cash), short of your $30,000 minimum profit and your 20% return on cash. The highest price that meets your targets is $87,447, which is $5,553 below this price.');
  expect(decision.hurdleResults.map((item) => [item.label, item.pass])).toEqual([['Profit', false], ['Return on cash', false]]);
  expect(decision.openingRange).toEqual([80000, 84000]);
  expect(decision.profitability.rule70).toBe(77250);
  expect(decision.profitability.cushion).toBeCloseTo(0.1037, 4);
  expect(decision.profitability.breakEvenArv).toBeCloseTo(224064, 0);
  expect(decision.profitability.rehabCushion).toBeCloseTo(0.2838, 4);
});

test('running the deal at the profit ceiling earns exactly the minimum profit', () => {
  const ceiling = flipAt({}).ceilings.find((item) => item.key === 'profit').value;
  const profit = analyzeDealLocally(buildDealRequest({ ...ruralFixerForm, purchasePrice: String(ceiling) })).metrics.flip_profit.value;
  expect(profit).toBeGreaterThanOrEqual(30000);
  expect(profit).toBeLessThan(30002);
  const roiCeiling = flipAt({}).ceilings.find((item) => item.key === 'roi').value;
  const roi = analyzeDealLocally(buildDealRequest({ ...ruralFixerForm, purchasePrice: String(roiCeiling) })).metrics.flip_roi.value;
  expect(roi).toBeGreaterThanOrEqual(0.2);
  expect(roi).toBeLessThan(0.2001);
});

test('the 70% rule is listed as a screen, never binds, and exceeding it is an exception', () => {
  const decision = flipAt({});
  const screen = decision.ceilings.find((item) => item.key === 'rule70');
  expect(screen.screen).toBe(true);
  expect(screen.binding).toBe(false);
  expect(screen.value).toBe(77250);
  expect(decision.walkAwaySignals).toContain('The price is $15,750 above the 70% rule screening figure of $77,250. The rule is a screen, not a valuation; it says the margin is thin for the work involved, so the after-repair value and the budget must hold.');
  expect(decision.walkAwaySignals).toContain('The downside case loses $2,269.');
  // A 70% figure below every target ceiling never changes the maximum.
  expect(decision.exactMaximum).toBeGreaterThan(screen.value);
});

test('within 5% above the ceiling the call is to negotiate', () => {
  const decision = flipAt({ purchasePrice: '90000' });
  expect(decision.call).toBe('NEGOTIATE');
  expect(decision.verdict).toBe('NEGOTIATE — WITHIN 5% OF THE CEILING');
  expect(decision.summary).toContain('short of your $30,000 minimum profit and your 20% return on cash. The highest price that meets your targets is $87,447, which is $2,553 below this price.');
});

test('a price that meets the targets is a conditional Go until the evidence is verified, then a Go', () => {
  const conditional = flipAt({ purchasePrice: '77000' });
  expect(conditional.call).toBe('CONDITIONAL GO');
  expect(conditional.verdict).toBe('CONDITIONAL GO — VERIFY BEFORE CLOSING');
  expect(conditional.walkAwaySignals).toEqual([]);
  expect(conditional.openingRange).toBeNull();
  expect(conditional.summary).toBe('At $77,000 the deal is modeled to earn $41,063 (29.86% on cash), which meets your targets. The highest price that still meets them is $87,447.');
  expect(conditional.evidenceGaps).toHaveLength(7);
  expect(conditional.confidence).toBe('Low');
  const go = buildFlipDecision({ form: { ...ruralFixerForm, purchasePrice: '77000' }, evidence: allFlipEvidence });
  expect(go.call).toBe('GO');
  expect(go.verdict).toBe('GO — MEETS YOUR TARGETS');
  expect(go.tone).toBe('green');
  expect(go.confidence).toBe('High');
  expect(go.evidenceGaps).toEqual([]);
});

test('exceptions make a flip that meets its targets conditional', () => {
  // Meets the targets with every item verified, but the price is above the
  // 70% screening figure.
  const screened = buildFlipDecision({ form: { ...ruralFixerForm, purchasePrice: '80000' }, evidence: allFlipEvidence });
  expect(screened.hurdleResults.every((item) => item.pass)).toBe(true);
  expect(screened.verdict).toBe('CONDITIONAL GO — RESOLVE EXCEPTIONS');
  expect(screened.walkAwaySignals).toEqual(['The price is $2,750 above the 70% rule screening figure of $77,250. The rule is a screen, not a valuation; it says the margin is thin for the work involved, so the after-repair value and the budget must hold.']);
  // Meets the targets, but the sale is a month after the loan comes due.
  const overdue = buildFlipDecision({ form: { ...ruralFixerForm, purchasePrice: '70000', holdMonths: '13' }, evidence: allFlipEvidence });
  expect(overdue.hurdleResults.every((item) => item.pass)).toBe(true);
  expect(overdue.verdict).toBe('CONDITIONAL GO — RESOLVE EXCEPTIONS');
  expect(overdue.walkAwaySignals).toContain('The 13-month hold is longer than the 12-month loan term, so the loan would need extending to the sale; the model extends it at the same rate. Confirm the extension terms and fee with the lender, and add the fee to other project costs.');
  // The extension keeps the figures sane: profit at 13 months is the 10-month
  // profit less three more months of holding costs and interest, not less the
  // whole loan balance.
  const atTen = buildFlipDecision({ form: { ...ruralFixerForm, purchasePrice: '70000', holdMonths: '10' }, evidence: allFlipEvidence });
  expect(atTen.profitability.profit - overdue.profitability.profit).toBeLessThan(3 * (450 + 70000 * 0.7 * 0.11 / 12) + 1);
  expect(overdue.profitability.roi).toBeGreaterThan(atTen.profitability.roi * 0.7);
});

test('a thin cushion is an exception that says how far the after-repair value can fall', () => {
  const decision = buildFlipDecision({ form: { ...ruralFixerForm, purchasePrice: '95000', flipMinimumProfit: '20000', flipTargetRoi: '0' }, evidence: allFlipEvidence });
  expect(decision.hurdleResults.every((item) => item.pass)).toBe(true);
  expect(decision.verdict).toBe('CONDITIONAL GO — RESOLVE EXCEPTIONS');
  expect(decision.profitability.cushion).toBeCloseTo(0.0946, 3);
  expect(decision.walkAwaySignals).toContain('The after-repair value can fall only 9.46% before the deal loses money.');
});

test('a deal that loses money, or that no price can rescue, is a No-Go that says why', () => {
  const losing = flipAt({ purchasePrice: '130000' });
  expect(losing.verdict).toBe('NO-GO — THE DEAL LOSES MONEY');
  expect(losing.summary).toContain('At $130,000 the deal is modeled to lose $15,059');
  const unreachable = flipAt({ flipMinimumProfit: '200000' });
  expect(unreachable.verdict).toBe('NO-GO — NO PRICE MEETS YOUR TARGETS');
  expect(unreachable.exactMaximum).toBeNull();
  expect(unreachable.summary).toBe('At $93,000 the deal is modeled to earn $24,121 (16.83% on cash). With the after-repair value and costs entered, no price meets your targets.');
  expect(flipAt({ arv: '0' }).verdict).toBe('NO-GO — NO AFTER-REPAIR VALUE ENTERED');
});

test('the return-on-cash target is optional and a zero minimum profit means break-even', () => {
  const profitOnly = flipAt({ flipTargetRoi: '0' });
  expect(profitOnly.hurdleResults.map((item) => item.label)).toEqual(['Profit']);
  expect(profitOnly.ceilings.map((item) => item.key)).toEqual(['profit', 'rule70']);
  expect(profitOnly.summary).toContain('short of your $30,000 minimum profit. The highest price');
  const breakEven = flipAt({ flipMinimumProfit: '0', flipTargetRoi: '0' });
  expect(breakEven.ceilings[0].label).toBe('Break-even (no minimum profit)');
  // The price at which profit is exactly zero: $93,000 plus $24,121 / 1.0589.
  expect(breakEven.exactMaximum).toBeGreaterThan(115700);
  expect(breakEven.exactMaximum).toBeLessThan(115800);
});

test('downside, base and upside are ordered, and the stressed rehab replaces the contingency', () => {
  const decision = flipAt({});
  const [downside, base, upside] = decision.scenarios;
  expect([downside.name, base.name, upside.name]).toEqual(['Downside', 'Base', 'Upside']);
  expect(downside.metrics.profit).toBeLessThan(base.metrics.profit);
  expect(base.metrics.profit).toBeLessThan(upside.metrics.profit);
  expect(base.metrics.profit).toBeCloseTo(24121, 0);
  expect(downside.assumptions).toEqual({ arv: '225000', rehabCost: '97750', rehabContingency: '0', holdMonths: '10' });
  expect(upside.assumptions).toEqual({ arv: '262500', rehabContingency: '0' });
  // Base margin is profit over the after-repair value.
  expect(base.metrics.margin).toBeCloseTo(24121 / 250000, 4);
  expect(decision.scenarioNote).toContain('the overrun replaces the contingency');
});

test('the untouched page example is a conditional Go with the default targets', () => {
  const example = buildFlipDecision({ form: {
    strategy: 'flip', propertyType: 'single_family', market: 'Atlanta, GA', units: '1', rentableSquareFeet: '1800',
    purchasePrice: '180000', closingCosts: '5500', dueDiligenceCosts: '1500', initialCapex: '0', holdMonths: '10',
    ltv: '65', interestRate: '6.75', amortizationYears: '30', interestOnlyMonths: '10', loanTermYears: '1', originationFee: '1',
    arv: '360000', rehabCost: '65000', rehabContingency: '10', monthlyHolding: '1800', otherProjectCosts: '6000',
    sellingCosts: '6', discountRate: '10', flipMinimumProfit: '30000', flipTargetRoi: '20',
  }, evidence: {} });
  expect(example.verdict).toBe('CONDITIONAL GO — VERIFY BEFORE CLOSING');
  expect(example.summary).toBe('At $180,000 the deal is modeled to earn $48,149 (27.79% on cash), which meets your targets. The highest price that still meets them is $192,034.');
  expect(example.recommendedMaximum).toBe(192000);
  expect(example.walkAwaySignals).toEqual([]);
});

test('the flip decision reads the listing history and seller posture, and checks the figures', () => {
  const now = new Date(2026, 9, 22);
  const listed = buildFlipDecision({ form: {
    ...ruralFixerForm, purchasePrice: '77000', lastSalePrice: '135000', lastSaleDate: '2025-04', originalListPrice: '141900',
    daysOnMarket: '270', ownerType: 'agent', disclosureStatus: 'none', saleTerms: 'as_is', compSoldPerSf: '120',
    flipAnnualTaxes: '1220', flipAnnualInsurance: '1241', flipMonthlyUtilities: '166',
  }, evidence: allFlipEvidence, today: now });
  // The targets are met and every item is ticked, so these facts alone turn a Go into a conditional Go.
  expect(listed.hurdleResults.every((item) => item.pass)).toBe(true);
  expect(listed.verdict).toBe('CONDITIONAL GO — RESOLVE EXCEPTIONS');
  expect(listed.walkAwaySignals).toEqual([
    'Monthly holding costs are entered as $450, but taxes, insurance and utilities add up to $371 a month.',
    'The seller paid $135,000 18 months ago and is asking $58,000 (43%) less. Selling below their own basis after a short hold usually means a failed project or a problem found; find out which before relying on the budget.',
    'Listed at $141,900 and cut 46% to $77,000 over 270 days on market. The market has already passed at higher prices: verify the after-repair value against sold prices, not asking prices.',
    '270 days on market at this price points to a thin buyer pool. The resale may take longer too: stress the hold period.',
    'The seller is a licensed agent selling their own property and gives no disclosure: assume they know something you do not. Order the inspections, and septic and well tests where they apply, before the diligence period ends.',
    'The after-repair value is $151/sf, 26% above the $120/sf of the renovated comparable sales entered, which imply $198,600. Use sold prices of the same kind of house, size, age and setting; a different kind of property does not price this one.',
  ]);
  expect(listed.intelligence.facts.map((fact) => fact.label)).toEqual([
    'Last sale', 'Original list price', 'Days on market', 'Seller',
    'After-repair value per square foot', 'Purchase price per square foot', 'Renovated comparable sales', 'Holding costs from their parts',
  ]);
  expect(listed.intelligence.facts.at(-1).detail).toBe('taxes $102, insurance $103, utilities $166 a month; $450 entered');
  expect(listed.intelligence.notes).toEqual(['Sold as-is: the 15% contingency is the only repair credit you will get.']);
  expect(listed.version).toBe(DECISION_VERSION);
  expect(DECISION_VERSION).toBe('diamond-decision-1.6.0');
});

test('with nothing typed about the listing, the flip decision only reminds, and never stacks exceptions', () => {
  const plain = flipAt({ purchasePrice: '77000' });
  expect(plain.walkAwaySignals).toEqual([]);
  expect(plain.intelligence.facts.map((fact) => fact.label)).toEqual(['After-repair value per square foot', 'Purchase price per square foot']);
  expect(plain.intelligence.notes).toEqual(['Enter the sold price per square foot of renovated houses of the same kind to check the after-repair value. A cabin, acreage or new-build sale does not price an older frame house.']);
  // Holding costs that match their parts within 10% are not an exception.
  expect(flipAt({ purchasePrice: '77000', flipAnnualTaxes: '1220', flipAnnualInsurance: '1241', flipMonthlyUtilities: '245' }).walkAwaySignals).toEqual([]);
  expect(flipAt({ purchasePrice: '77000', monthlyHolding: '0' }).walkAwaySignals).toEqual(['No monthly holding costs are entered; taxes, insurance and utilities run for every month of the hold.']);
});

test('the stressed flip cases keep the loan at its base size', () => {
  // On the after-repair-value basis a 10% lower exit would otherwise shrink the loan.
  const decision = flipAt({ purchasePrice: '77000', loanBasis: 'after_repair_value' });
  const [downside, base] = decision.scenarios;
  const baseRequest = buildDealRequest({ ...ruralFixerForm, purchasePrice: '77000', loanBasis: 'after_repair_value' });
  expect(analyzeDealLocally(baseRequest).metrics.loan_amount.value).toBe(175000);
  const stressed = buildDealRequest({ ...ruralFixerForm, purchasePrice: '77000', loanBasis: 'after_repair_value', ...downside.assumptions });
  const kept = { ...stressed, debt: [{ ...stressed.debt[0], principal: 175000, loan_to_value: undefined }] };
  expect(downside.metrics.profit).toBeCloseTo(analyzeDealLocally(kept).metrics.flip_profit.value, 6);
  expect(downside.metrics.profit).not.toBeCloseTo(analyzeDealLocally(stressed).metrics.flip_profit.value, 0);
  expect(base.metrics.profit).toBeCloseTo(analyzeDealLocally(baseRequest).metrics.flip_profit.value, 6);
  // The upside spends no contingency, so its $171,000 of cost is below the
  // $175,000 loan: the loan is capped at the cost rather than the case failing.
  const upside = decision.scenarios[2];
  const upsideRequest = buildDealRequest({ ...ruralFixerForm, purchasePrice: '77000', loanBasis: 'after_repair_value', ...upside.assumptions });
  const capped = { ...upsideRequest, debt: [{ ...upsideRequest.debt[0], principal: 171000, loan_to_value: undefined }] };
  expect(upside.metrics.profit).toBeCloseTo(analyzeDealLocally(capped).metrics.flip_profit.value, 6);
  expect(upside.metrics.profit).toBeGreaterThan(base.metrics.profit);
});
