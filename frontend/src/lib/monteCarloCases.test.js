import { buildMonteCarloScenarios, MONTE_CARLO_CASES } from './monteCarloCases';

test('every Monte Carlo run includes all three committee cases in a stable order', () => {
  const scenarios = buildMonteCarloScenarios({
    iterations: '2500',
    driversForCase: (name) => ({ case_name: name }),
  });

  expect(scenarios.map((scenario) => scenario.name)).toEqual(MONTE_CARLO_CASES);
  expect(scenarios).toHaveLength(3);
  expect(scenarios.map((scenario) => scenario.seed)).toEqual([2026, 2123, 2220]);
  expect(new Set(scenarios.map((scenario) => scenario.seed)).size).toBe(3);
  expect(scenarios.every((scenario) => scenario.iterations === 2500)).toBe(true);
  expect(scenarios[2].drivers).toEqual({ case_name: 'Severe stress' });
});
