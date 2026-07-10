import { analyzeDealLocally, runMonteCarloLocally } from './dealAnalysis';

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
