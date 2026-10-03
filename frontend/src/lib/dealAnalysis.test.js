import { analyzeDealLocally, lossEquivalentReturn, runMonteCarloLocally } from './dealAnalysis';

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
