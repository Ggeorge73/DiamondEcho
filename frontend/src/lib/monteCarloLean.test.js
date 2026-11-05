import { simulationLean } from './monteCarloLean';

// The example bands of each tab, as the page starts them.
const land = {
  strategy: 'land', interestRate: '6.75', landContingency: '10',
  mcArvMin: '-10', mcArvMode: '0', mcArvMax: '10', mcRehabMin: '0', mcRehabMode: '10', mcRehabMax: '30',
  mcHoldMin: '0', mcHoldMode: '1', mcHoldMax: '4', mcInterestMin: '5.75', mcInterestMode: '6.75', mcInterestMax: '8.5',
};
const rental = {
  strategy: 'rental', interestRate: '6.75', vacancy: '5', exitCap: '6.5', explicitSalePrice: '',
  mcRentMin: '-10', mcRentMode: '2', mcRentMax: '10', mcVacancyMin: '3', mcVacancyMode: '6', mcVacancyMax: '14',
  mcExpenseMin: '-3', mcExpenseMode: '3', mcExpenseMax: '15', mcExitCapMin: '5.75', mcExitCapMode: '6.75', mcExitCapMax: '8',
  mcInterestMin: '5.75', mcInterestMode: '6.75', mcInterestMax: '8.5',
};

test('the land example leans to the downside on costs, the hold and the rate, and is centred on the exit value', () => {
  const lean = simulationLean(land);
  expect(lean.downside).toEqual([
    'development costs average 3.33 points over budget beyond the 10% contingency the base analysis spends',
    'the hold averages 1.67 months longer than the one you entered',
    'the interest rate averages 0.25 points above the 6.75% you entered',
  ]);
  expect(lean.upside).toEqual([]);
});

test('the rental example leans to the downside on vacancy, expenses, the exit cap and the rate, and slightly up on rent', () => {
  const lean = simulationLean(rental);
  expect(lean.downside).toEqual([
    'vacancy averages 2.67 points above the 5% you entered',
    'operating expenses average 5% above those you entered',
    'the exit cap rate averages 0.33 points above the 6.5% you entered',
    'the interest rate averages 0.25 points above the 6.75% you entered',
  ]);
  expect(lean.upside).toEqual(['rent averages 0.67% above the rent you entered']);
});

test('bands set the same distance either side of the entered figure are centred', () => {
  const lean = simulationLean({ ...land, mcRehabMin: '0', mcRehabMode: '10', mcRehabMax: '20', mcHoldMin: '-2', mcHoldMode: '0', mcHoldMax: '2', mcInterestMin: '5.75', mcInterestMode: '6.75', mcInterestMax: '7.75' });
  expect(lean).toEqual({ downside: [], upside: [] });
});

test('an expected sale price replaces the exit cap, so the exit-cap band is not judged', () => {
  const lean = simulationLean({ ...rental, explicitSalePrice: '5000000' });
  expect(lean.downside.some((item) => /exit cap/.test(item))).toBe(false);
});

test('a fixed-rate loan with the band at the rate does not lean', () => {
  const lean = simulationLean({ ...land, mcInterestMin: '6.75', mcInterestMode: '6.75', mcInterestMax: '6.75', mcRehabMax: '20', mcHoldMin: '-2', mcHoldMode: '0', mcHoldMax: '2' });
  expect(lean.downside).toEqual([]);
});
