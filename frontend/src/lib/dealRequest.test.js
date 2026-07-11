import { analyzeDealLocally } from './dealAnalysis';
import { buildDealRequest } from './dealRequest';

test('form-to-request-to-results pipeline reconciles the default rental case', () => {
  const form = {
    strategy: 'rental', propertyType: 'multifamily', market: 'Austin, TX', units: '12', rentableSquareFeet: '18000',
    purchasePrice: '3000000', closingCosts: '75000', dueDiligenceCosts: '25000', initialCapex: '125000', holdMonths: '60',
    ltv: '65', interestRate: '6.75', amortizationYears: '30', interestOnlyMonths: '0', loanTermYears: '10', originationFee: '1',
    sellingCosts: '6', discountRate: '10', annualRent: '360000', otherIncome: '18000', vacancy: '5',
    propertyTaxes: '54000', insurance: '24000', repairsMaintenance: '18000', utilities: '12000', payrollAdmin: '18000',
    managementFee: '4', reserves: '30000', annualBelowNoiCosts: '10000', incomeGrowth: '3', expenseGrowth: '3',
    exitCap: '6.5', explicitSalePrice: '',
  };
  const result = analyzeDealLocally(buildDealRequest(form));
  expect(result.metrics.noi.value).toBe(219600);
  expect(result.metrics.irr.value).toBeCloseTo(0.10086487, 7);
  expect(result.metrics.npv.value).toBeCloseTo(4818.09145427, 4);
  expect(result.metrics.equity_multiple.value).toBeCloseTo(1.58026557, 7);
});

