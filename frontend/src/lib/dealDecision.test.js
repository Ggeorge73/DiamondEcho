import { buildRentalDecision } from './dealDecision';

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
  expect(decision.recommendedMaximum).toBe(325000);
  expect(decision.verdict).toBe('REPRICE OR PASS');
  expect(decision.openingRange).toEqual([300000, 315000]);
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
