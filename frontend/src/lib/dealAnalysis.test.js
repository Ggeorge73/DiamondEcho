import { analyzeDealLocally, BROWSER_MONTE_CARLO_ITERATION_CAP, lossEquivalentReturn, nextTask, runMonteCarloInBrowser, runMonteCarloLocally } from './dealAnalysis';
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
  expect(result.metrics.development_profit.value).toBe(835001);
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

test('residual land value is the price at which the deal earns exactly the target margin', () => {
  // It used to take the target margin off net proceeds and leave out loan fees,
  // so it could sit above the price while the margin missed its target.
  const first = landAt();
  expect(first.metrics.development_margin.value).toBeCloseTo(0.13359738, 8);
  expect(first.metrics.residual_land_value.value).toBeCloseTo(724062.14302033, 6);
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
  expect(result.metrics.development_profit.value).toBeCloseTo(-2756112.29691015, 6);
  expect(result.metrics.development_margin.value).toBeCloseTo(-0.6124694, 8);
  expect(result.metrics.irr.value).toBeCloseTo(-0.37373084, 8);
  expect(result.metrics.residual_land_value.value).toBeCloseTo(2315.27304722, 6);
  expect(result.metrics.break_even_terminal_value.value).toBeCloseTo(7432034.35841515, 6);
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
  beforeEach(() => { timers = jest.spyOn(global, 'setTimeout'); });
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
