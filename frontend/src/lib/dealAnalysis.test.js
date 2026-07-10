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

