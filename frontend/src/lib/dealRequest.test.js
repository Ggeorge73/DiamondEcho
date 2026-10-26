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


test('the flip loan options are sent only when they differ from their defaults, so an older service still answers', () => {
  const form = {
    strategy: 'flip', propertyType: 'single_family', units: '1', rentableSquareFeet: '1655',
    purchasePrice: '93000', closingCosts: '3000', dueDiligenceCosts: '2000', initialCapex: '0', holdMonths: '7',
    ltv: '70', interestRate: '11', amortizationYears: '30', interestOnlyMonths: '7', loanTermYears: '1', originationFee: '2',
    arv: '250000', rehabCost: '85000', rehabContingency: '15', monthlyHolding: '450', otherProjectCosts: '4000',
    sellingCosts: '7', discountRate: '10', rehabFinanced: '0', loanBasis: 'purchase_price',
  };
  const plain = buildDealRequest(form).debt[0];
  expect(plain).not.toHaveProperty('rehab_financed_rate');
  expect(plain).not.toHaveProperty('loan_basis');
  expect(buildDealRequest({ ...form, rehabFinanced: '', loanBasis: '' }).debt[0]).not.toHaveProperty('loan_basis');
  const chosen = buildDealRequest({ ...form, rehabFinanced: '100', loanBasis: 'after_repair_value' }).debt[0];
  expect(chosen.rehab_financed_rate).toBe(1);
  expect(chosen.loan_basis).toBe('after_repair_value');
  // Left out means the defaults: the browser engine sizes the loan on the price alone.
  expect(analyzeDealLocally(buildDealRequest(form)).metrics.loan_amount.value).toBe(65100);
});
