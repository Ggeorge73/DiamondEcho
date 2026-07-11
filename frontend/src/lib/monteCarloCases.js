export const MONTE_CARLO_CASES = ['Committee case', 'Downside case', 'Severe stress'];

export const buildMonteCarloScenarios = ({ iterations, driversForCase }) =>
  MONTE_CARLO_CASES.map((name, index) => ({
    name,
    iterations: Number(iterations || 0),
    seed: 2026 + index * 97,
    drivers: driversForCase(name),
  }));
