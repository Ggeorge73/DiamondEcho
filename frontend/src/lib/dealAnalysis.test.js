import { analyzeDealLocally, BROWSER_MONTE_CARLO_ITERATION_CAP, FORMULA_VERSION, loanPrincipal, lossEquivalentReturn, nextTask, pinLoans, runMonteCarloInBrowser, runMonteCarloLocally, totalProjectCost } from './dealAnalysis';
import { buildDealRequest } from './dealRequest';

const johnsCreekDeal = {
  strategy: 'rental',
  property: { property_type: 'single_family', unit_count: 3, rentable_square_feet: 15000, market: 'Johns Creek', currency: 'USD' },
  acquisition: { purchase_price: 999999, closing_costs: 0, due_diligence_costs: 0, initial_capex: 0, hold_months: 60 },
  debt: [],
  operating: { gross_scheduled_rent: 0, other_income: 0, vacancy_rate: 0, credit_loss_rate: 0, operating_expenses: 0, management_fee_rate: 0, replacement_reserves: 0, annual_below_noi_costs: 0, annual_income_growth_rate: 0, annual_expense_growth_rate: 0 },
  exit: { selling_cost_rate: 0 }, assumptions: { annual_discount_rate: 0 },
};

test('calculates the submitted Johns Creek zero-income case in the browser', () => {
  const result = analyzeDealLocally(johnsCreekDeal);
  expect(result.metrics.noi.value).toBe(0);
  expect(result.metrics.npv.value).toBe(-999999);
  expect(result.metrics.equity_multiple.value).toBe(0);
  expect(result.metrics.irr.value).toBeNull();
  expect(result.warnings.join(' ')).toContain('No terminal value');
});

test('accepts an explicit terminal value when an exit cap is not meaningful', () => {
  const result = analyzeDealLocally({ ...johnsCreekDeal, exit: { explicit_sale_price: 1800000, selling_cost_rate: 0 } });
  expect(result.metrics.irr.value).toBeGreaterThan(0);
  expect(result.metrics.sale_price.value).toBe(1800000);
});

test('local Monte Carlo is deterministic', () => {
  const request = { deal: { ...johnsCreekDeal, exit: { explicit_sale_price: 1800000, selling_cost_rate: 0 } }, scenarios: [{ name: 'Committee case', iterations: 250, seed: 73, drivers: { rent_change: { minimum: -0.1, mode: 0, maximum: 0.1 } } }] };
  expect(runMonteCarloLocally(request)).toEqual(runMonteCarloLocally(request));
});

test('underwrites a ground-up land development with residual land value', () => {
  const deal = {
    strategy: 'land', property: { property_type: 'land', unit_count: 3, rentable_square_feet: 15000, market: 'Johns Creek', currency: 'USD' },
    acquisition: { purchase_price: 999999, closing_costs: 0, due_diligence_costs: 0, initial_capex: 0, hold_months: 24 },
    debt: [], exit: { selling_cost_rate: 0.05 }, assumptions: { annual_discount_rate: 0.1 },
    land: {
      development_type: 'single_family_subdivision', disposition_strategy: 'build_and_sell', site_acres: 2.5,
      parcel_count: 1, current_zoning: 'R-4A', proposed_zoning: 'R-4A', entitlement_status: 'fully_entitled',
      planned_units: 3, buildable_square_feet: 15000, development_months: 24, site_work_cost: 300000,
      hard_construction_cost: 1500000, soft_costs: 200000, permits_impact_fees: 100000,
      environmental_remediation: 0, developer_fee: 100000, contingency_rate: 0.1,
      annual_carrying_costs: 30000, expected_terminal_value: 4500000, stabilized_noi: 0,
      stabilized_exit_cap_rate: 0, target_profit_margin: 0.2,
    },
  };
  const result = analyzeDealLocally(deal);
  expect(result.metrics.development_profit.value).toBeCloseTo(835001, 4);
  expect(result.metrics.cost_per_unit.value).toBeCloseTo(1126666.33, 1);
  expect(result.metrics.residual_land_value.value).toBeGreaterThan(0);
  expect(result.metrics.irr.value).toBeGreaterThan(0);
  const risk = runMonteCarloLocally({ deal, scenarios: [{ name: 'Land downside', iterations: 50, seed: 73, drivers: {
    terminal_value_change: { minimum: -0.15, mode: 0, maximum: 0.1 },
    development_cost_change: { minimum: 0, mode: 0.1, maximum: 0.3 },
  } }] });
  expect(risk.scenarios[0].summaries.development_profit.p50).not.toBeNull();
});

const flipDeal = (principal) => ({
  strategy: 'flip',
  property: { property_type: 'single_family', unit_count: 1, currency: 'USD' },
  acquisition: { purchase_price: 200000, closing_costs: 0, due_diligence_costs: 0, initial_capex: 0, hold_months: 6 },
  debt: [{ name: 'Hard money', principal, annual_interest_rate: 0.1, amortization_years: 30, interest_only_months: 6, term_months: 12, origination_fee_rate: 0 }],
  flip: { after_repair_value: 420000, rehab_cost: 100000, rehab_contingency_rate: 0, monthly_holding_costs: 0, other_project_costs: 0 },
  exit: { selling_cost_rate: 0.06 }, assumptions: { annual_discount_rate: 0.1 },
});
const rehabSwing = { rehab_cost_change: { minimum: -0.9, mode: 0, maximum: 0.5 } };

test('iterations with invalid economics are counted and excluded instead of stopping the run', () => {
  const [result] = runMonteCarloLocally({ deal: flipDeal(250000), scenarios: [{ name: 'Thin equity', iterations: 500, seed: 73, drivers: rehabSwing }] }).scenarios;
  expect(result.failed_iterations).toBeGreaterThan(0);
  expect(result.iterations_completed).toBe(500 - result.failed_iterations);
  expect(result.summaries.flip_profit.sample_size).toBe(result.iterations_completed);
  expect(result.warnings).toContain(`${result.failed_iterations} iterations were excluded because sampled inputs produced invalid economics.`);
});

test('a case where every iteration is invalid fails with the reason', () => {
  expect(() => runMonteCarloLocally({ deal: flipDeal(400000), scenarios: [{ name: 'No equity', iterations: 250, seed: 73, drivers: rehabSwing }] }))
    .toThrow("Monte Carlo scenario 'No equity' produced no valid iterations: Initial debt and loan proceeds must leave a positive equity contribution.");
});

test('each summary carries the number of results it was measured on', () => {
  const [result] = runMonteCarloLocally({ deal: johnsCreekDeal, scenarios: [{ name: 'No income', iterations: 250, seed: 73, drivers: { rent_change: { minimum: -0.1, mode: 0, maximum: 0.1 } } }] }).scenarios;
  expect(result.iterations_completed).toBe(250);
  expect(result.summaries.npv.sample_size).toBe(250);
  expect(result.summaries.npv.loss_without_irr_count).toBe(0);
});

test('an iteration that returns no cash is counted as a -100% IRR instead of being left out', () => {
  const [result] = runMonteCarloLocally({ deal: johnsCreekDeal, scenarios: [{ name: 'No income', iterations: 250, seed: 73, drivers: { rent_change: { minimum: -0.1, mode: 0, maximum: 0.1 } } }] }).scenarios;
  expect(analyzeDealLocally(johnsCreekDeal).metrics.irr.value).toBeNull();
  expect(result.summaries.irr.sample_size).toBe(250);
  expect(result.summaries.irr.loss_without_irr_count).toBe(250);
  expect(result.summaries.irr.p10).toBe(-1);
  expect(result.summaries.irr.p90).toBe(-1);
  expect(result.summaries.irr.probability_above_zero).toBe(0);
});

test('the loss-equivalent return applies only to losses', () => {
  expect(lossEquivalentReturn(0, 60)).toBe(-1);
  expect(lossEquivalentReturn(0.15, 60)).toBeCloseTo(0.15 ** 0.2 - 1, 12);
  expect(lossEquivalentReturn(0.15, 60)).toBeCloseTo(-0.3157, 4);
  expect(lossEquivalentReturn(0.5, 12)).toBeCloseTo(-0.5, 12);
  expect(lossEquivalentReturn(1, 60)).toBeNull();
  expect(lossEquivalentReturn(1.4, 60)).toBeNull();
  expect(lossEquivalentReturn(null, 60)).toBeNull();
  expect(lossEquivalentReturn(0.5, 0)).toBeNull();
});

test('an under-water sale after some income is scored by cash returned over cash invested', () => {
  // Income arrives monthly, then the sale cannot repay the loan: no IRR solves these cash flows.
  const deal = {
    strategy: 'rental',
    property: { property_type: 'multifamily', unit_count: 12, currency: 'USD' },
    acquisition: { purchase_price: 3000000, closing_costs: 0, due_diligence_costs: 0, initial_capex: 0, hold_months: 60 },
    debt: [{ name: 'Senior', loan_to_value: 0.65, annual_interest_rate: 0.0675, amortization_years: 30, interest_only_months: 60, term_months: 120, origination_fee_rate: 0 }],
    operating: { gross_scheduled_rent: 360000, other_income: 0, vacancy_rate: 0.05, credit_loss_rate: 0, operating_expenses: 126000, management_fee_rate: 0.04, replacement_reserves: 0, annual_below_noi_costs: 0, annual_income_growth_rate: 0, annual_expense_growth_rate: 0 },
    exit: { explicit_sale_price: 1500000, selling_cost_rate: 0.06 }, assumptions: { annual_discount_rate: 0.1 },
  };
  const base = analyzeDealLocally(deal);
  expect(base.metrics.irr.value).toBeNull();
  expect(base.cash_flows.some((row) => row.net_cash_flow > 0)).toBe(true);
  const multiple = base.metrics.equity_multiple.value;
  expect(multiple).toBeGreaterThan(0);
  expect(multiple).toBeLessThan(1);
  const [result] = runMonteCarloLocally({ deal, scenarios: [{ name: 'Fixed', iterations: 250, seed: 73, drivers: { interest_rate: { minimum: 0.0675, mode: 0.0675, maximum: 0.0675 } } }] }).scenarios;
  expect(result.summaries.irr.sample_size).toBe(250);
  expect(result.summaries.irr.loss_without_irr_count).toBe(250);
  expect(result.summaries.irr.p50).toBeCloseTo(multiple ** (12 / 60) - 1, 9);
  expect(result.summaries.irr.probability_above_zero).toBe(0);
});

// ---------------------------------------------------------------------------
// DE-25: land residual, flood zone, and the stepped simulation.
const landForm = {
  address: '', strategy: 'land', propertyType: 'land', market: 'Atlanta, GA', units: '4', rentableSquareFeet: '12000',
  purchasePrice: '985000', closingCosts: '20000', dueDiligenceCosts: '15000', initialCapex: '0', holdMonths: '24',
  ltv: '65', interestRate: '6.75', amortizationYears: '30', interestOnlyMonths: '24', loanTermYears: '2', originationFee: '1',
  sellingCosts: '6', discountRate: '10', developmentType: 'single_family_subdivision', dispositionStrategy: 'build_and_sell',
  siteAcres: '2.5', parcelCount: '1', currentZoning: '', proposedZoning: '', entitlementStatus: 'unentitled',
  utilityStatus: 'verify', accessStatus: 'verify', environmentalStatus: 'phase_i_required', geotechnicalStatus: 'not_started',
  floodZone: '', wetlandsAcres: '0', developmentMonths: '18', absorptionMonths: '6', siteWorkCost: '250000',
  hardConstructionCost: '1400000', softCosts: '150000', permitsImpactFees: '60000', environmentalRemediation: '0',
  developerFee: '80000', landContingency: '10', annualCarryingCosts: '24000', expectedTerminalValue: '4300000',
  stabilizedNoi: '0', stabilizedExitCap: '0', targetProfitMargin: '20',
};
const landAt = (changes = {}) => analyzeDealLocally(buildDealRequest({ ...landForm, ...changes }));

describe('the land contingency absorbs a simulated cost change instead of multiplying it', () => {
  // Site work + hard construction carry the contingency; the other four cost
  // fields do not.
  const contingencyBasis = 250000 + 1400000;
  const otherCosts = 150000 + 60000 + 0 + 80000;
  const landCostFields = ['site_work_cost', 'hard_construction_cost', 'soft_costs', 'permits_impact_fees', 'environmental_remediation', 'developer_fee'];
  // One value for low, mode and high draws that value every time, so the
  // simulation becomes a deterministic re-run with that cost change.
  const simulatedProfit = (change, contingency = '10') => {
    const deal = buildDealRequest({ ...landForm, landContingency: contingency });
    const result = runMonteCarloLocally({ deal, scenarios: [{ name: 'Fixed', iterations: 250, seed: 7, drivers: { development_cost_change: { minimum: change, mode: change, maximum: change } } }] });
    const summary = result.scenarios[0].summaries.development_profit;
    expect(summary.minimum).toBeCloseTo(summary.maximum, 6);
    return summary.p50;
  };
  // Scaled on the request, as the simulation does, so the loan (sized by the
  // form on total cost, contingency included) is the same in every case.
  const profitWithCostsScaled = (factor, contingencyRate) => {
    const deal = buildDealRequest(landForm);
    landCostFields.forEach((field) => { deal.land[field] *= factor; });
    deal.land.contingency_rate = contingencyRate;
    return analyzeDealLocally(deal).metrics.development_profit.value;
  };

  // Since 1.7.0 the budget is spent over the development months and the
  // facility drawn as it is spent, so a cost dollar also moves the draws and
  // the interest a little: the cases are compared deal for deal, not by adding
  // the cost dollars to the base profit.
  test('a 30% rise on a 10% contingency costs 30% over budget, not 43%', () => {
    const simulated = simulatedProfit(0.30);
    expect(simulated).toBeCloseTo(profitWithCostsScaled(1.30, 0), 2);
    // The old result: 1.3 x 1.1 = 43% over on site work and hard construction.
    expect(simulated).toBeGreaterThan(profitWithCostsScaled(1.30, 0.10) + contingencyBasis * 1.30 * 0.10 * 0.9);
    expect(simulated).not.toBeCloseTo(profitWithCostsScaled(1.30, 0.10), 0);
  });

  test('a draw equal to the contingency is the base case on the contingency basis, and a smaller one is better by the unspent reserve', () => {
    // Site work and hard construction come out exactly as in the base case;
    // the four costs that carry no contingency still rise by the draw.
    expect(simulatedProfit(0.10)).toBeCloseTo(profitWithCostsScaled(1.10, 0), 2);
    expect(simulatedProfit(0.05)).toBeCloseTo(profitWithCostsScaled(1.05, 0), 2);
    expect(simulatedProfit(0)).toBeCloseTo(profitWithCostsScaled(1, 0), 2);
    const base = landAt().metrics.development_profit.value;
    expect(simulatedProfit(0)).toBeGreaterThan(base + contingencyBasis * 0.10 * 0.9);
    expect(simulatedProfit(0.05)).toBeGreaterThan(simulatedProfit(0.10));
    // On the two fields that carry it, a draw equal to the contingency is the base case.
    expect(profitWithCostsScaled(1.10, 0)).toBeCloseTo(base - otherCosts * 0.10, -3);
    expect(otherCosts).toBe(290000);
  });

  test('without a contingency the whole cost change is taken', () => {
    const deal = buildDealRequest({ ...landForm, landContingency: '0' });
    const scaled = buildDealRequest({ ...landForm, landContingency: '0' });
    landCostFields.forEach((field) => { scaled.land[field] *= 1.20; });
    expect(simulatedProfit(0.20, '0')).toBeCloseTo(analyzeDealLocally(scaled).metrics.development_profit.value, 2);
    expect(simulatedProfit(0.20, '0')).toBeLessThan(analyzeDealLocally(deal).metrics.development_profit.value);
  });

  test('the service and browser engines carry the same change in their formula versions', () => {
    expect(runMonteCarloLocally({ deal: buildDealRequest(landForm), scenarios: [{ name: 'Fixed', iterations: 10, seed: 7, drivers: { development_cost_change: { minimum: 0, mode: 0, maximum: 0 } } }] }).formula_version).toBe(FORMULA_VERSION);
  });
});

test('residual land value is the price at which the deal earns exactly the target margin', () => {
  // It used to take the target margin off net proceeds and leave out loan fees,
  // so it could sit above the price while the margin missed its target.
  const first = landAt();
  expect(first.metrics.development_margin.value).toBeCloseTo(0.16120289, 8);
  expect(first.metrics.residual_land_value.value).toBeCloseTo(831051.13226601, 6);
  const again = landAt({ purchasePrice: String(first.metrics.residual_land_value.value) });
  expect(again.metrics.development_margin.value).toBeCloseTo(0.2, 7);
  expect(again.metrics.residual_land_value.value).toBeCloseTo(first.metrics.residual_land_value.value, 4);
});

test.each([[0.98, true], [1.02, false]])('at %s times the residual, the margin test and the residual agree', (factor, passes) => {
  const price = landAt().metrics.residual_land_value.value * factor;
  const result = landAt({ purchasePrice: String(price) });
  expect(result.metrics.development_margin.value >= 0.2).toBe(passes);
  expect(result.metrics.residual_land_value.value >= price).toBe(passes);
  expect(result.warnings.some((warning) => warning.includes('residual land value is below'))).toBe(!passes);
});

test('the land figures match the analysis service for its reference deal', () => {
  // Same request and same figures as test_land_development_matches_the_browser_engine
  // in backend/tests/deal_intelligence/test_engine.py.
  const result = landAt({
    units: '12', rentableSquareFeet: '18000', purchasePrice: '3000000', closingCosts: '75000', dueDiligenceCosts: '25000',
    initialCapex: '125000', holdMonths: '60', interestOnlyMonths: '0', loanTermYears: '10', developmentMonths: '24',
    absorptionMonths: '12', siteWorkCost: '300000', hardConstructionCost: '1500000', softCosts: '200000',
    permitsImpactFees: '100000', developerFee: '100000', annualCarryingCosts: '30000', expectedTerminalValue: '4500000',
  });
  expect(result.metrics.development_profit.value).toBeCloseTo(-2483459.11392855, 6);
  expect(result.metrics.development_margin.value).toBeCloseTo(-0.5518798, 8);
  expect(result.metrics.irr.value).toBeCloseTo(-0.32278589, 8);
  expect(result.metrics.npv.value).toBeCloseTo(-2485468.16259679, 6);
  expect(result.metrics.equity_multiple.value).toBeCloseTo(0.2879165, 8);
  expect(result.metrics.residual_land_value.value).toBeCloseTo(188393.53109743, 6);
  expect(result.metrics.break_even_terminal_value.value).toBeCloseTo(7141977.78077513, 6);
  expect(result.cash_flows[0].net_cash_flow).toBeCloseTo(-1165182.5, 6);
  expect(result.cash_flows[1].debt_service).toBeCloseTo(23630.05015322, 6);
  expect(result.cash_flows[60].sale_proceeds).toBe(352500);
  expect(result.cash_flows[60].loan_payoff).toBe(0);
});

test('"Not verified" typed as the flood zone is not treated as an entered zone', () => {
  const flood = (text) => landAt({ floodZone: text }).warnings.filter((warning) => /lood/.test(warning));
  expect(flood('Not verified')).toEqual(['The FEMA flood zone is not verified; confirm the designation, base flood elevation, and insurance requirement.']);
  expect(flood('')).toEqual(flood('Not verified'));
  expect(flood('X')).toEqual([]);
  expect(flood('AE')[0]).toContain('Special Flood Hazard Area');
});

const landDrivers = {
  terminal_value_change: { minimum: -0.15, mode: 0, maximum: 0.1 },
  development_cost_change: { minimum: 0, mode: 0.1, maximum: 0.3 },
  interest_rate: { minimum: 0.0575, mode: 0.0675, maximum: 0.085 },
};
const threeCases = (iterations) => ['Committee case', 'Downside case', 'Severe stress'].map((name, index) => ({ name, iterations, seed: 2026 + index * 97, drivers: landDrivers }));
const immediately = () => Promise.resolve();

test('the stepped simulation gives exactly the figures of the one-go simulation and reports progress', async () => {
  const payload = { deal: buildDealRequest(landForm), scenarios: threeCases(600) };
  const progress = [];
  const stepped = await runMonteCarloInBrowser(payload, { onProgress: (done, total) => progress.push([done, total]), blockSize: 125, pause: immediately });
  expect(stepped).toEqual(runMonteCarloLocally(payload));
  expect(progress[0]).toEqual([0, 1800]);
  expect(progress[progress.length - 1]).toEqual([1800, 1800]);
  expect(progress.map(([done]) => done)).toEqual([...progress.map(([done]) => done)].sort((a, b) => a - b));
  expect(stepped.scenarios.map((scenario) => scenario.iterations_completed)).toEqual([600, 600, 600]);
});

test('every choice on the form is run in full: 10,000 per case is within the cap', async () => {
  expect(BROWSER_MONTE_CARLO_ITERATION_CAP).toBe(10000);
  const result = await runMonteCarloInBrowser({ deal: buildDealRequest(landForm), scenarios: threeCases(10000).slice(0, 1) }, { blockSize: 2500, pause: immediately });
  const [scenario] = result.scenarios;
  expect(scenario.iterations_requested).toBe(10000);
  expect(scenario.iterations_completed + scenario.failed_iterations).toBe(10000);
  expect(scenario.warnings.some((warning) => warning.includes('capped'))).toBe(false);
});

test('a stepped simulation told to stop returns nothing instead of partial figures', async () => {
  let rounds = 0;
  const result = await runMonteCarloInBrowser({ deal: buildDealRequest(landForm), scenarios: threeCases(1000) }, { blockSize: 100, pause: immediately, shouldStop: () => { rounds += 1; return rounds >= 2; } });
  expect(result).toBeNull();
  expect(rounds).toBe(2);
});

describe('the pause between simulation blocks', () => {
  const realChannel = global.MessageChannel;
  let timers;
  beforeEach(() => { timers = vi.spyOn(global, 'setTimeout'); });
  afterEach(() => {
    timers.mockRestore();
    if (realChannel === undefined) delete global.MessageChannel; else global.MessageChannel = realChannel;
  });

  // A browser slows the timers of a tab that is not in view to one a second,
  // then one a minute. A message is not slowed, so the run keeps its pace.
  class FakeChannel {
    constructor() {
      FakeChannel.made += 1;
      this.port1 = { onmessage: null, close: () => { FakeChannel.closed += 1; } };
      this.port2 = { postMessage: () => { Promise.resolve().then(() => this.port1.onmessage({ data: null })); } };
    }
  }

  test('waits on a message, not a timer, where the browser has message channels', async () => {
    FakeChannel.made = 0; FakeChannel.closed = 0;
    global.MessageChannel = FakeChannel;
    await nextTask();
    expect(FakeChannel.made).toBe(1);
    expect(FakeChannel.closed).toBe(1);
    expect(timers).not.toHaveBeenCalled();
  });

  test('a whole simulation run sets no timer, so a tab out of view is not slowed', async () => {
    FakeChannel.made = 0; FakeChannel.closed = 0;
    global.MessageChannel = FakeChannel;
    const payload = { deal: buildDealRequest(landForm), scenarios: threeCases(500) };
    const result = await runMonteCarloInBrowser(payload, { blockSize: 125 });
    expect(result).toEqual(runMonteCarloLocally(payload));
    expect(FakeChannel.made).toBe(4);
    expect(FakeChannel.closed).toBe(4);
    expect(timers).not.toHaveBeenCalled();
  });

  test('falls back to a timer where there are no message channels', async () => {
    delete global.MessageChannel;
    await nextTask();
    expect(timers).toHaveBeenCalledTimes(1);
  });
});

// A rural fixer underwritten on 2026-10-22: $93,000 price, hard-money loan at
// 70% / 11% / interest only / 2 points, $85,000 rehab with a 15% contingency,
// $250,000 after-repair value, seven-month hold. The figures were checked by
// hand and match the analysis service to the dollar.
const ruralFixerForm = {
  strategy: 'flip', propertyType: 'single_family', market: '', units: '1', rentableSquareFeet: '1655',
  purchasePrice: '93000', closingCosts: '3000', dueDiligenceCosts: '2000', initialCapex: '0', holdMonths: '7',
  ltv: '70', interestRate: '11', amortizationYears: '30', interestOnlyMonths: '7', loanTermYears: '1', originationFee: '2',
  arv: '250000', rehabCost: '85000', rehabContingency: '15', monthlyHolding: '450', otherProjectCosts: '4000',
  sellingCosts: '7', discountRate: '10',
};

test('the fix-and-flip reference deal matches the figures checked by hand', () => {
  const { metrics } = analyzeDealLocally(buildDealRequest(ruralFixerForm));
  expect(metrics.flip_profit.value).toBeCloseTo(24121, -1);
  expect(metrics.flip_roi.value).toBeCloseTo(0.1683, 4);
  expect(metrics.irr.value).toBeCloseTo(0.3156, 4);
  expect(metrics.npv.value).toBeCloseTo(15296, -1);
  expect(metrics.equity_multiple.value).toBeCloseTo(1.17, 2);
  expect(metrics.ltc.value).toBeCloseTo(0.326, 3);
  expect(metrics.max_offer_70_rule.value).toBe(77250);
});

describe('the rehab contingency absorbs a simulated overrun instead of multiplying it', () => {
  // One value for low, mode and high draws that value every time, so the
  // simulation becomes a deterministic re-run with that overrun.
  const simulatedProfit = (overrun, contingency = '15') => {
    const deal = buildDealRequest({ ...ruralFixerForm, rehabContingency: contingency });
    const result = runMonteCarloLocally({ deal, scenarios: [{ name: 'Fixed', iterations: 250, seed: 7, drivers: { rehab_cost_change: { minimum: overrun, mode: overrun, maximum: overrun } } }] });
    const summary = result.scenarios[0].summaries.flip_profit;
    expect(summary.minimum).toBeCloseTo(summary.maximum, 6);
    return summary.p50;
  };
  const profitWithRehab = (rehabCost, contingency) => analyzeDealLocally(buildDealRequest({ ...ruralFixerForm, rehabCost: String(rehabCost), rehabContingency: contingency })).metrics.flip_profit.value;

  test('a 35% overrun on a 15% contingency costs 35% over budget, not 55%', () => {
    const simulated = simulatedProfit(0.35);
    expect(simulated).toBeCloseTo(profitWithRehab(85000 * 1.35, '0'), 2);
    // Item 6 of the 2026-10-22 review: the old result, 1.35 x 1.15 = 55% over.
    expect(simulated).toBeGreaterThan(profitWithRehab(85000 * 1.35, '15') + 10000);
  });

  test('a draw equal to the contingency is the base case, and a smaller one is better by the unspent reserve', () => {
    const base = analyzeDealLocally(buildDealRequest(ruralFixerForm)).metrics.flip_profit.value;
    expect(simulatedProfit(0.15)).toBeCloseTo(base, 2);
    expect(simulatedProfit(0.10)).toBeCloseTo(base + 85000 * 0.05, 2);
    expect(simulatedProfit(0)).toBeCloseTo(base + 85000 * 0.15, 2);
  });

  test('without a contingency the whole overrun is taken', () => {
    expect(simulatedProfit(0.20, '0')).toBeCloseTo(profitWithRehab(85000 * 1.20, '0'), 2);
  });

  test('a simulation result carries the browser formula version, so it says which rule produced it', () => {
    expect(FORMULA_VERSION).toMatch(/^diamond-underwriting-web-1\.[5-9]\.\d+$|^diamond-underwriting-web-[2-9]\./);
    expect(runMonteCarloLocally({ deal: buildDealRequest(ruralFixerForm), scenarios: [{ name: 'Fixed', iterations: 250, seed: 7, drivers: { rehab_cost_change: { minimum: 0, mode: 0, maximum: 0 } } }] }).formula_version).toBe(FORMULA_VERSION);
  });
});

describe('a flip loan can fund a share of the rehab budget', () => {
  const profitAt = (rehabFinanced) => analyzeDealLocally(buildDealRequest({ ...ruralFixerForm, rehabFinanced })).metrics;

  test('the loan is loan-to-value times the price plus the financed rehab, and costs its points and interest', () => {
    const onPriceOnly = profitAt('0');
    const withRehab = profitAt('100');
    expect(onPriceOnly.ltc.value).toBeCloseTo(0.326, 3);
    // 70% of $93,000 plus all of the $85,000 budget: $150,100 on $199,750 of cost.
    expect(withRehab.ltc.value).toBeCloseTo(150100 / 199750, 6);
    expect(withRehab.ltv.value).toBeCloseTo(150100 / 93000, 6);
    expect(withRehab.flip_profit.value).toBeCloseTo(onPriceOnly.flip_profit.value - 85000 * (0.02 + 0.11 * 7 / 12), 2);
    expect(withRehab.flip_roi.value).toBeGreaterThan(onPriceOnly.flip_roi.value);
  });

  test('the request carries the share, and the workbook sizes the loan the same way', () => {
    const request = buildDealRequest({ ...ruralFixerForm, rehabFinanced: '100' });
    expect(request.debt[0].rehab_financed_rate).toBe(1);
    expect(buildDealRequest({ ...ruralFixerForm, strategy: 'rental', annualRent: '12000', exitCap: '7' }).debt[0].rehab_financed_rate).toBeUndefined();
  });
});

describe('the hold period is a simulation driver in whole months', () => {
  const fixedHold = (months, form = ruralFixerForm) => {
    const result = runMonteCarloLocally({ deal: buildDealRequest(form), scenarios: [{ name: 'Fixed', iterations: 250, seed: 7, drivers: { hold_months_change: { minimum: months, mode: months, maximum: months } } }] });
    const summary = result.scenarios[0].summaries.flip_profit;
    expect(summary.minimum).toBeCloseTo(summary.maximum, 6);
    return summary.p50;
  };
  const profitWithHold = (holdMonths) => analyzeDealLocally(buildDealRequest({ ...ruralFixerForm, holdMonths })).metrics.flip_profit.value;

  test('three months longer is the seven-month deal re-run at ten months', () => {
    expect(fixedHold(3)).toBeCloseTo(profitWithHold('10'), 2);
    expect(fixedHold(3)).toBeLessThan(profitWithHold('7'));
    expect(fixedHold(2.6)).toBeCloseTo(profitWithHold('10'), 2);
  });

  test('the hold never drops below one month, and the base deal is untouched between iterations', () => {
    expect(fixedHold(-20)).toBeCloseTo(profitWithHold('1'), 2);
    const deal = buildDealRequest(ruralFixerForm);
    runMonteCarloLocally({ deal, scenarios: [{ name: 'Fixed', iterations: 250, seed: 7, drivers: { hold_months_change: { minimum: 3, mode: 3, maximum: 3 } } }] });
    expect(deal.acquisition.hold_months).toBe(7);
  });
});

describe('the loan basis', () => {
  const metricsAt = (changes) => analyzeDealLocally(buildDealRequest({ ...ruralFixerForm, ...changes })).metrics;

  test('the loan is loan-to-value times the price, the total project cost or the after-repair value', () => {
    const request = buildDealRequest(ruralFixerForm);
    expect(totalProjectCost(request)).toBe(199750);
    expect(metricsAt({}).loan_amount.value).toBe(65100);
    expect(metricsAt({}).loan_amount.formula).toBe('loan-to-value x purchase price');
    expect(metricsAt({ loanBasis: 'total_project_cost' }).loan_amount.value).toBeCloseTo(139825, 2);
    expect(metricsAt({ loanBasis: 'after_repair_value' }).loan_amount.value).toBe(175000);
    expect(metricsAt({ loanBasis: 'after_repair_value' }).ltv.value).toBeCloseTo(175000 / 93000, 6);
    expect(metricsAt({ loanBasis: 'after_repair_value' }).ltc.value).toBeCloseTo(175000 / 199750, 6);
  });

  test('the financed share of the rehab applies to the price basis only, because the other bases already carry it', () => {
    expect(metricsAt({ rehabFinanced: '100' }).loan_amount.value).toBe(150100);
    expect(metricsAt({ rehabFinanced: '100' }).loan_amount.formula).toBe('loan-to-value x purchase price + financed share of the rehab budget');
    expect(metricsAt({ rehabFinanced: '100', loanBasis: 'total_project_cost' }).loan_amount.value).toBeCloseTo(139825, 2);
    expect(metricsAt({ rehabFinanced: '100', loanBasis: 'after_repair_value' }).loan_amount.value).toBe(175000);
    // An explicit loan amount is taken as given.
    const request = buildDealRequest({ ...ruralFixerForm, loanBasis: 'after_repair_value' });
    request.debt[0] = { ...request.debt[0], principal: 100000, loan_to_value: undefined };
    expect(loanPrincipal(request, request.debt[0])).toBe(100000);
    expect(analyzeDealLocally(request).metrics.loan_amount.formula).toBe('loan amount as entered');
  });

  test('the simulation keeps the loan at its base size when a draw moves the after-repair value or the rehab', () => {
    const deal = buildDealRequest({ ...ruralFixerForm, loanBasis: 'after_repair_value' });
    const pinned = pinLoans(deal);
    expect(pinned.debt[0].principal).toBe(175000);
    expect(pinned.debt[0].loan_to_value).toBeUndefined();
    expect(deal.debt[0].principal).toBeUndefined();
    const fixedArv = runMonteCarloLocally({ deal, scenarios: [{ name: 'Fixed', iterations: 250, seed: 7, drivers: { after_repair_value_change: { minimum: -0.1, mode: -0.1, maximum: -0.1 } } }] }).scenarios[0].summaries.flip_profit.p50;
    const resized = buildDealRequest({ ...ruralFixerForm, loanBasis: 'after_repair_value', arv: '225000' });
    const kept = { ...resized, debt: [{ ...resized.debt[0], principal: 175000, loan_to_value: undefined }] };
    expect(fixedArv).toBeCloseTo(analyzeDealLocally(kept).metrics.flip_profit.value, 2);
    expect(fixedArv).not.toBeCloseTo(analyzeDealLocally(resized).metrics.flip_profit.value, 0);
    // The same for a rehab overrun on a loan that funds the rehab budget.
    const funded = buildDealRequest({ ...ruralFixerForm, rehabFinanced: '100' });
    const overrun = runMonteCarloLocally({ deal: funded, scenarios: [{ name: 'Fixed', iterations: 250, seed: 7, drivers: { rehab_cost_change: { minimum: 0.35, mode: 0.35, maximum: 0.35 } } }] }).scenarios[0].summaries.flip_profit.p50;
    const overrunKept = { ...funded, flip: { ...funded.flip, rehab_cost: 85000 * 1.35, rehab_contingency_rate: 0 }, debt: [{ ...funded.debt[0], principal: 150100, loan_to_value: undefined }] };
    expect(overrun).toBeCloseTo(analyzeDealLocally(overrunKept).metrics.flip_profit.value, 2);
    // A rental's loan is left as sent.
    const rental = buildDealRequest({ ...ruralFixerForm, strategy: 'rental', annualRent: '12000', exitCap: '7' });
    expect(pinLoans(rental)).toBe(rental);
  });

  test('a pinned loan never exceeds the project cost the draw leaves', () => {
    // A rehab draw of 0 spends no contingency: $187,000 of cost under a $175,000
    // after-repair-value loan is fine, but at a lower price the cost drops
    // below the loan and the lender funds the cost and no more.
    const deal = buildDealRequest({ ...ruralFixerForm, purchasePrice: '70000', loanBasis: 'after_repair_value' });
    const run = runMonteCarloLocally({ deal, scenarios: [{ name: 'Fixed', iterations: 250, seed: 7, drivers: { rehab_cost_change: { minimum: 0, mode: 0, maximum: 0 } } }] }).scenarios[0];
    expect(run.failed_iterations).toBe(0);
    const cost = 70000 + 3000 + 2000 + 85000 + 4000;
    const capped = { ...deal, flip: { ...deal.flip, rehab_contingency_rate: 0 }, debt: [{ ...deal.debt[0], principal: cost, loan_to_value: undefined }] };
    expect(run.summaries.flip_profit.p50).toBeCloseTo(analyzeDealLocally(capped).metrics.flip_profit.value, 2);
  });
});

// ---------------------------------------------------------------------------
// Item 3 of the 2026-10-26 review: the development schedule and absorption
// boxes did nothing, and the facility was drawn in full on day one.
describe('a land development follows its timetable', () => {
  const flows = (changes = {}) => landAt(changes).cash_flows;

  test('the schedule and absorption inputs move the figures', () => {
    const quick = landAt({ developmentMonths: '6', absorptionMonths: '1' }).metrics.development_profit.value;
    const even = landAt({ developmentMonths: '12', absorptionMonths: '12' }).metrics.development_profit.value;
    expect(quick).not.toBeCloseTo(even, 0);
    expect(quick).toBeCloseTo(601406.17, 1);
    expect(even).toBeCloseTo(721412.73, 1);
  });

  test('the budget is spent over the development months and the sales fall in the absorption months', () => {
    const rows = flows({ developmentMonths: '18', absorptionMonths: '6' });
    // 18 months of spend at 1/18 of the budget each, plus carrying; then carrying alone.
    const budget = (250000 + 1400000) * 1.1 + 150000 + 60000 + 80000;
    expect(rows[1].capital_costs).toBeCloseTo(budget / 18 + 2000, 4);
    expect(rows[18].capital_costs).toBeCloseTo(budget / 18 + 2000, 4);
    expect(rows[19].capital_costs).toBe(2000);
    expect(rows.slice(1, 19).every((row) => row.sale_proceeds === 0)).toBe(true);
    rows.slice(19).forEach((row) => expect(row.sale_proceeds).toBeCloseTo(4300000 * 0.94 / 6, 4));
    expect(rows.reduce((sum, row) => sum + row.sale_proceeds, 0)).toBeCloseTo(4300000 * 0.94, 4);
  });

  test('the facility is drawn as the money is spent, so interest starts low and grows', () => {
    const rows = flows();
    expect(rows[1].debt_service).toBeLessThan(rows[2].debt_service);
    expect(rows[2].debt_service).toBeLessThan(rows[18].debt_service);
    // Fully drawn after month 18: 65% of the $3,125,000 cost at 6.75% / 12.
    expect(rows[19].debt_service).toBeCloseTo(3125000 * 0.65 * 0.0675 / 12, 4);
    // The old model charged that from the first month.
    expect(rows[1].debt_service).toBeLessThan(rows[19].debt_service / 2);
  });

  test('sale proceeds pay the facility down first, and the rest is the sponsor\'s', () => {
    const rows = flows();
    const facility = 3125000 * 0.65;
    const paid = rows.reduce((sum, row) => sum + row.loan_payoff, 0);
    expect(paid).toBeCloseTo(facility, 4);
    // The first sale month goes wholly to the lender; the last ones to the sponsor.
    expect(rows[19].loan_payoff).toBeCloseTo(rows[19].sale_proceeds, 4);
    expect(rows[24].loan_payoff).toBe(0);
    expect(rows[24].net_cash_flow).toBeGreaterThan(0);
    // The cash flows change sign once, so the IRR is defined.
    expect(landAt().metrics.irr.value).toBeCloseTo(0.36482976, 8);
  });

  test('the equity goes in as the money is spent, not all on day one', () => {
    const rows = flows();
    // At closing: 35% of the acquisition cost plus the points on the whole facility.
    expect(rows[0].net_cash_flow).toBeCloseTo(-((985000 + 20000 + 15000) * 0.35 + 3125000 * 0.65 * 0.01), 4);
    expect(rows[0].capital_costs).toBeCloseTo(1020000 + 3125000 * 0.65 * 0.01, 4);
    // Every development month: 35% of that month's spend, the carrying and the interest.
    const budget = 3125000 - 1020000;
    expect(rows[1].net_cash_flow).toBeCloseTo(-(budget / 18 * 0.35 + 2000 + rows[1].debt_service), 4);
  });

  test('a hold shorter than the schedule is refused, and idle months are said', () => {
    // The second pass of the review: a 3-month hold on a 12 + 12 schedule read as a Go at a 741,908% IRR.
    expect(() => landAt({ holdMonths: '3', developmentMonths: '12', absorptionMonths: '12' })).toThrow('The 3-month hold is shorter than the development schedule plus the absorption (12 + 12 months). Lengthen the hold or shorten the schedule.');
    expect(() => landAt({ developmentMonths: '24', absorptionMonths: '12' })).toThrow('The 24-month hold is shorter than');
    // In a simulation such an iteration is excluded, not shown.
    const shortened = runMonteCarloLocally({ deal: buildDealRequest(landForm), scenarios: [{ name: 'Short', iterations: 40, seed: 5, drivers: { hold_months_change: { minimum: -3, mode: 0, maximum: 0 } } }] }).scenarios[0];
    expect(shortened.failed_iterations).toBeGreaterThan(0);
    expect(shortened.iterations_completed).toBeGreaterThan(0);
    expect(shortened.failed_iterations + shortened.iterations_completed).toBe(40);
    expect(() => runMonteCarloLocally({ deal: buildDealRequest(landForm), scenarios: [{ name: 'All short', iterations: 5, seed: 5, drivers: { hold_months_change: { minimum: -12, mode: -12, maximum: -12 } } }] })).toThrow('The 12-month hold is shorter than the development schedule plus the absorption (18 + 6 months)');
    const idle = landAt({ developmentMonths: '6', absorptionMonths: '6' });
    expect(idle.warnings).toContain('The hold is 12 months longer than development plus absorption; carrying costs and interest on the drawn facility run for those months too.');
    expect(landAt().warnings.some((warning) => /longer than/.test(warning))).toBe(false);
    // Zero absorption is one sale in the final month.
    const rows = flows({ absorptionMonths: '0' });
    expect(rows[23].sale_proceeds).toBe(0);
    expect(rows[24].sale_proceeds).toBeCloseTo(4300000 * 0.94, 4);
  });

  test('the residual land value is solved on the same timetable, so re-running at it earns the target margin', () => {
    for (const changes of [{}, { developmentMonths: '6', absorptionMonths: '1' }, { interestOnlyMonths: '0', amortizationYears: '25' }, { expectedTerminalValue: '3600000' }]) {
      const residual = landAt(changes).metrics.residual_land_value.value;
      expect(landAt({ ...changes, purchasePrice: String(residual) }).metrics.development_margin.value).toBeCloseTo(0.2, 7);
    }
  });

  test('the simulation leaves the residual out, and its figures are the deal\'s own', () => {
    const deal = buildDealRequest(landForm);
    const result = runMonteCarloLocally({ deal, scenarios: [{ name: 'Fixed', iterations: 20, seed: 3, drivers: { terminal_value_change: { minimum: 0, mode: 0, maximum: 0 } } }] });
    expect(result.scenarios[0].summaries.development_profit.p50).toBeCloseTo(landAt().metrics.development_profit.value, 6);
    expect(result.scenarios[0].summaries.irr.p50).toBeCloseTo(landAt().metrics.irr.value, 8);
    expect(result.scenarios[0].summaries.residual_land_value).toBeUndefined();
    expect(analyzeDealLocally(deal, { residual: false }).metrics.residual_land_value).toBeUndefined();
    expect(analyzeDealLocally(deal).metrics.residual_land_value.value).toBeCloseTo(831051.13226601, 6);
  });
});

// Item 4 of the 2026-10-26 review: DSCR was computed before the reserves and
// TI that lenders deduct, while cash-on-cash deducted them.
test('a rental reports its debt service coverage before and after reserves and TI', () => {
  const request = buildDealRequest({
    strategy: 'rental', propertyType: 'multifamily', units: '12', rentableSquareFeet: '18000', purchasePrice: '3000000',
    closingCosts: '75000', dueDiligenceCosts: '25000', initialCapex: '125000', holdMonths: '60', ltv: '65', interestRate: '6.75',
    amortizationYears: '30', interestOnlyMonths: '0', loanTermYears: '10', originationFee: '1', annualRent: '360000', otherIncome: '18000',
    vacancy: '5', propertyTaxes: '54000', insurance: '24000', repairsMaintenance: '18000', utilities: '12000', payrollAdmin: '18000',
    managementFee: '4', reserves: '30000', annualBelowNoiCosts: '10000', incomeGrowth: '3', expenseGrowth: '3', exitCap: '6.5',
    explicitSalePrice: '', sellingCosts: '6', discountRate: '10',
  });
  const result = analyzeDealLocally(request);
  expect(result.metrics.dscr.value).toBeCloseTo(1.44690764, 8);
  expect(result.metrics.dscr_after_reserves.value).toBeCloseTo(1.18335433, 8);
  const noi = result.metrics.noi.value; const debt = result.metrics.dscr.components.debt_service;
  expect(result.metrics.dscr_after_reserves.value).toBeCloseTo((noi - 40000) / debt, 8);
  expect(result.metrics.dscr_after_reserves.formula).toBe('(year-one NOI - replacement reserves - TI, leasing and capital costs) / year-one debt service');
  expect(result.warnings.some((warning) => /shorter than 12 months/.test(warning))).toBe(false);
  // Item 2: a hold shorter than a year is said, as the service says it.
  const short = analyzeDealLocally({ ...request, acquisition: { ...request.acquisition, hold_months: 5 } });
  expect(short.warnings).toContain('Year-one operating metrics are annualized from a holding period shorter than 12 months.');
});

// The second pass of the 2026-10-26 review: a flip whose hold outran the loan
// term had the whole balance paid from the investor's pocket at maturity, with
// interest stopping, and no warning; the downside case (three months longer)
// hit the same trap. The loan is now extended to the sale at the same rate.
describe('a loan whose term ends before the hold is extended, not paid at maturity', () => {
  const example = {
    strategy: 'flip', propertyType: 'single_family', market: 'Atlanta, GA', units: '1', rentableSquareFeet: '1800',
    purchasePrice: '180000', closingCosts: '5500', dueDiligenceCosts: '1500', initialCapex: '0', holdMonths: '10',
    ltv: '65', interestRate: '6.75', amortizationYears: '30', interestOnlyMonths: '10', loanTermYears: '1', originationFee: '1',
    arv: '360000', rehabCost: '65000', rehabContingency: '10', monthlyHolding: '1800', otherProjectCosts: '6000',
    sellingCosts: '6', discountRate: '10',
  };
  const flipAt = (changes = {}) => analyzeDealLocally(buildDealRequest({ ...example, ...changes }));

  test('interest runs to the sale, the balance is repaid from the sale, and the result says so', () => {
    // Interest only through the 12-month term; the thirteenth month amortizes.
    const thirteen = flipAt({ holdMonths: '13', interestOnlyMonths: '12' });
    const interest = 117000 * 0.0675 / 12;
    for (const month of [11, 12]) expect(thirteen.cash_flows[month].debt_service).toBeCloseTo(interest, 6);
    expect(thirteen.cash_flows[13].debt_service).toBeGreaterThan(interest);
    expect(thirteen.cash_flows[12].loan_payoff).toBe(0);
    // The balance is repaid at the sale, less the one scheduled principal payment.
    expect(thirteen.cash_flows[13].loan_payoff + (thirteen.cash_flows[13].debt_service - interest)).toBeCloseTo(117000, 6);
    expect(thirteen.warnings).toContain('The 13-month hold is longer than the 12-month loan term, so the loan is modeled as extended to the end of the hold at the same rate. Confirm the extension terms and fee with the lender, and add the fee to the costs.');
    // Three more months cost three months of holding and interest, nothing more.
    const ten = flipAt();
    expect(ten.metrics.flip_profit.value - thirteen.metrics.flip_profit.value).toBeCloseTo(3 * (1800 + interest), 4);
    expect(thirteen.metrics.flip_roi.value).toBeGreaterThan(0.2);
    expect(ten.warnings.some((warning) => /loan term/.test(warning))).toBe(false);
  });

  test('a term equal to the hold, or longer, is unchanged and silent', () => {
    const twelve = flipAt({ holdMonths: '12', interestOnlyMonths: '12' });
    expect(twelve.cash_flows[12].loan_payoff).toBeCloseTo(117000, 6);
    expect(twelve.cash_flows[12].debt_service).toBeCloseTo(117000 * 0.0675 / 12, 6);
    expect(twelve.warnings.some((warning) => /loan term/.test(warning))).toBe(false);
  });

  test('a rental and a land deal get the same treatment', () => {
    const rental = analyzeDealLocally(buildDealRequest({
      strategy: 'rental', propertyType: 'multifamily', units: '12', rentableSquareFeet: '18000', purchasePrice: '3000000',
      closingCosts: '75000', dueDiligenceCosts: '25000', initialCapex: '125000', holdMonths: '60', ltv: '65', interestRate: '6.75',
      amortizationYears: '30', interestOnlyMonths: '0', loanTermYears: '3', originationFee: '1', annualRent: '360000', otherIncome: '18000',
      vacancy: '5', propertyTaxes: '54000', insurance: '24000', repairsMaintenance: '18000', utilities: '12000', payrollAdmin: '18000',
      managementFee: '4', reserves: '30000', annualBelowNoiCosts: '10000', incomeGrowth: '3', expenseGrowth: '3', exitCap: '6.5',
      explicitSalePrice: '', sellingCosts: '6', discountRate: '10',
    }));
    expect(rental.cash_flows[36].debt_service).toBeCloseTo(rental.cash_flows[37].debt_service, 6);
    expect(rental.cash_flows[60].loan_payoff).toBeGreaterThan(1500000);
    expect(rental.warnings).toContain('The 60-month hold is longer than the 36-month loan term, so the loan is modeled as extended to the end of the hold at the same rate. Confirm the extension terms and fee with the lender, and add the fee to the costs.');
    const land = landAt({ loanTermYears: '1' });
    expect(land.warnings.some((warning) => /24-month hold is longer than the 12-month loan term/.test(warning))).toBe(true);
    expect(land.metrics.development_profit.value).toBeCloseTo(landAt().metrics.development_profit.value, 6);
  });
});
