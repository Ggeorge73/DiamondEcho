import { scenarioDisclosure, splitWarnings } from './monteCarloDisclosure';
import { BROWSER_MONTE_CARLO_ITERATION_CAP, runMonteCarloLocally } from './dealAnalysis';

const deal = {
  strategy: 'rental', property: { property_type: 'multifamily', unit_count: 12 },
  acquisition: { purchase_price: 3000000, closing_costs: 75000, due_diligence_costs: 0, initial_capex: 0, hold_months: 60 },
  debt: [{ loan_to_value: 0.65, annual_interest_rate: 0.0675, amortization_years: 30, interest_only_months: 0, loan_term_years: 10, origination_fee_rate: 0 }],
  operating: { gross_scheduled_rent: 360000, other_income: 0, vacancy_rate: 0.05, operating_expenses: 126000, management_fee_rate: 0.04, replacement_reserves: 30000, income_growth_rate: 0.03, expense_growth_rate: 0.03, annual_below_noi_costs: 0 },
  exit: { exit_cap_rate: 0.065, selling_cost_rate: 0.06, discount_rate: 0.1 },
};
const scenario = (iterations) => ({
  name: 'Committee case', iterations, seed: 73,
  drivers: { rent_change: { minimum: -0.1, mode: 0, maximum: 0.08 }, vacancy_rate: { minimum: 0.03, mode: 0.06, maximum: 0.14 } },
});

test('a request above the device cap reports the cap, the counts and the sample behind each probability', () => {
  // The cap equals the largest choice on the form (DE-25); the service allows
  // up to 20,000, so a larger request can still arrive and must be disclosed.
  const [result] = runMonteCarloLocally({ deal, scenarios: [scenario(12000)] }).scenarios;
  expect(BROWSER_MONTE_CARLO_ITERATION_CAP).toBe(10000);
  expect(result.iterations_requested).toBe(12000);
  expect(result.iterations_completed + result.failed_iterations).toBe(10000);
  expect(result.warnings.some((warning) => warning.includes('capped at 10,000 iterations') && warning.includes('12,000 were requested'))).toBe(true);
  for (const summary of Object.values(result.summaries)) {
    expect(Number.isInteger(summary.sample_size)).toBe(true);
    expect(summary.sample_size).toBeLessThanOrEqual(result.iterations_completed);
  }
  const disclosure = scenarioDisclosure(result, result.summaries.irr, 'IRR');
  expect(disclosure.counts[0]).toBe('Requested 12,000');
  expect(disclosure.counts).toContain(`Completed ${result.iterations_completed.toLocaleString('en-US')}`);
  expect(disclosure.notes[0]).toBe('Only 10,000 of the 12,000 requested iterations were run.');
  expect(disclosure.denominator).toMatch(/^[\d,]+ above zero out of [\d,]+ valid results$/);
});

test('a run within the cap carries no cap notice', () => {
  const [result] = runMonteCarloLocally({ deal, scenarios: [scenario(1000)] }).scenarios;
  expect(result.iterations_completed + result.failed_iterations).toBe(1000);
  expect(result.warnings.some((warning) => warning.includes('capped'))).toBe(false);
  const { notes } = scenarioDisclosure(result, result.summaries.irr, 'IRR');
  expect(notes.some((note) => note.includes('requested iterations were run'))).toBe(false);
});

test('the denominator is the metric sample, not the iteration count', () => {
  const disclosure = scenarioDisclosure(
    { iterations_requested: 1000, iterations_completed: 990, failed_iterations: 10 },
    { probability_above_zero: 0.25, sample_size: 800 },
    'IRR',
  );
  expect(disclosure.counts).toEqual(['Requested 1,000', 'Completed 990', 'Excluded 10', 'Valid for IRR 800']);
  // The first number counts results above zero; the wording must say so, or it
  // reads as "200 valid results" (DE-25).
  expect(disclosure.denominator).toBe('200 above zero out of 800 valid results');
  expect(disclosure.notes).toEqual([
    '10 iterations were excluded because the sampled inputs produced invalid economics.',
    '190 completed iterations had no defined IRR and are left out of the figures above.',
  ]);
});

test('a result without the newer fields says so instead of guessing', () => {
  const disclosure = scenarioDisclosure({ iterations_completed: 10 }, { probability_above_zero: 1 }, 'IRR');
  expect(disclosure.counts).toEqual(['Completed 10', 'Valid for IRR not reported']);
  expect(disclosure.denominator).toBe('valid sample size not reported');
  expect(disclosure.notes).toEqual([]);
});

test('an empty metric sample is stated plainly', () => {
  const disclosure = scenarioDisclosure({ iterations_completed: 50, failed_iterations: 0 }, { probability_above_zero: 0, sample_size: 0 }, 'IRR');
  expect(disclosure.denominator).toBe('no valid IRR results');
  expect(disclosure.notes).toEqual(['50 completed iterations had no defined IRR and are left out of the figures above.']);
});

test('warnings shared by every case are shown once', () => {
  const { common, perScenario } = splitWarnings([
    { warnings: ['shared', 'only first'] }, { warnings: ['shared'] }, { warnings: ['shared', 'only third'] },
  ]);
  expect(common).toEqual(['shared']);
  expect(perScenario).toEqual([['only first'], [], ['only third']]);
  expect(splitWarnings([{ name: 'no warnings field' }])).toEqual({ common: [], perScenario: [[]] });
});

test('an engine sentence about a cap or exclusions is dropped only when the counts replace it', () => {
  const capped = 'Browser simulation capped at 5,000 iterations per case for responsiveness; 10,000 were requested.';
  const excluded = '10 iterations were excluded because sampled inputs produced invalid economics.';
  const withCounts = { iterations_requested: 10000, iterations_completed: 4990, failed_iterations: 10, warnings: ['keep', capped, excluded] };
  expect(splitWarnings([withCounts])).toEqual({ common: ['keep'], perScenario: [[]] });
  const withoutCounts = { iterations_completed: 4990, warnings: ['keep', capped, excluded] };
  expect(splitWarnings([withoutCounts]).common).toEqual(['keep', capped, excluded]);
});

test('the service time-limit sentence is replaced by the counts in the same way', () => {
  const stopped = 'Service simulation capped at 3,800 iterations for this case to answer in time; 10,000 were requested.';
  const scenario = { iterations_requested: 10000, iterations_completed: 3800, failed_iterations: 0, warnings: ['keep', stopped] };
  expect(splitWarnings([scenario])).toEqual({ common: ['keep'], perScenario: [[]] });
  const disclosure = scenarioDisclosure(scenario, { probability_above_zero: 0.5, sample_size: 3800 }, 'Projected IRR');
  expect(disclosure.counts.slice(0, 3)).toEqual(['Requested 10,000', 'Completed 3,800', 'Excluded 0']);
  expect(disclosure.notes[0]).toBe('Only 3,800 of the 10,000 requested iterations were run.');
});

test('losses with no solvable IRR are stated as counted, not left out', () => {
  const disclosure = scenarioDisclosure(
    { iterations_requested: 5000, iterations_completed: 5000, failed_iterations: 0 },
    { probability_above_zero: 0.0756, sample_size: 5000, loss_without_irr_count: 1140 },
    'Projected IRR',
  );
  expect(disclosure.denominator).toBe('378 above zero out of 5,000 valid results');
  expect(disclosure.notes).toEqual([
    '1,140 losing iterations had no solvable Projected IRR. They are counted as losses, using the annual return implied by cash returned over cash invested (-100% when nothing came back).',
  ]);
});
