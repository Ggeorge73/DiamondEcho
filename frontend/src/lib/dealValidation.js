const numericFields = [
  'units', 'rentableSquareFeet', 'purchasePrice', 'closingCosts', 'dueDiligenceCosts',
  'initialCapex', 'holdMonths', 'ltv', 'interestRate', 'amortizationYears',
  'interestOnlyMonths', 'loanTermYears', 'originationFee', 'sellingCosts',
  'discountRate', 'annualRent', 'otherIncome', 'vacancy', 'propertyTaxes',
  'insurance', 'repairsMaintenance', 'utilities', 'payrollAdmin', 'managementFee',
  'reserves', 'annualBelowNoiCosts', 'incomeGrowth', 'expenseGrowth', 'exitCap',
  'explicitSalePrice', 'arv', 'rehabCost', 'rehabContingency', 'monthlyHolding',
  'otherProjectCosts', 'siteAcres', 'parcelCount', 'wetlandsAcres',
  'developmentMonths', 'absorptionMonths', 'siteWorkCost', 'hardConstructionCost',
  'softCosts', 'permitsImpactFees', 'environmentalRemediation', 'developerFee',
  'landContingency', 'annualCarryingCosts', 'expectedTerminalValue',
  'stabilizedNoi', 'stabilizedExitCap', 'targetProfitMargin', 'mcIterations',
  'mcRentMin', 'mcRentMode', 'mcRentMax', 'mcVacancyMin', 'mcVacancyMode',
  'mcVacancyMax', 'mcExpenseMin', 'mcExpenseMode', 'mcExpenseMax',
  'mcExitCapMin', 'mcExitCapMode', 'mcExitCapMax', 'mcInterestMin',
  'mcInterestMode', 'mcInterestMax', 'mcArvMin', 'mcArvMode', 'mcArvMax',
  'mcRehabMin', 'mcRehabMode', 'mcRehabMax', 'targetCashOnCash', 'minimumDscr',
  'targetIrr', 'preliminaryMarketCeiling', 'maxImmediateCapex',
  'maxAnnualTaxes', 'maxAnnualInsurance',
];

const requireRange = (form, field, label, minimum, maximum, { integer = false, exclusive = false } = {}) => {
  const value = Number(form[field]);
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value))
      || (exclusive ? value <= minimum : value < minimum) || value > maximum) {
    throw new Error(`${label} must be ${exclusive ? 'greater than' : 'at least'} ${minimum} and no more than ${maximum}${integer ? ', in whole numbers' : ''}.`);
  }
};

export const validateDealForm = (form) => {
  for (const field of numericFields) {
    if (form[field] !== undefined && form[field] !== '' && !Number.isFinite(Number(form[field]))) {
      throw new Error(`${field} must be a valid number.`);
    }
  }
  for (const field of ['closingCosts', 'dueDiligenceCosts', 'initialCapex', 'otherIncome',
    'propertyTaxes', 'insurance', 'repairsMaintenance', 'utilities', 'payrollAdmin',
    'reserves', 'annualBelowNoiCosts', 'rehabCost', 'monthlyHolding', 'otherProjectCosts',
    'wetlandsAcres', 'absorptionMonths', 'siteWorkCost', 'hardConstructionCost',
    'softCosts', 'permitsImpactFees', 'environmentalRemediation', 'developerFee',
    'annualCarryingCosts', 'stabilizedNoi']) {
    if (Number(form[field] || 0) < 0) throw new Error(`${field} cannot be negative.`);
  }
  const requiredReviewed = [
    ['closingCosts', 'Closing costs'], ['dueDiligenceCosts', 'Due diligence'],
    ['initialCapex', 'Initial capital work'], ['sellingCosts', 'Selling costs'],
  ];
  if (form.strategy === 'rental') requiredReviewed.push(
    ['annualRent', 'Annual scheduled rent'], ['otherIncome', 'Other annual income'],
    ['vacancy', 'Vacancy'], ['propertyTaxes', 'Property taxes'],
    ['insurance', 'Insurance'], ['repairsMaintenance', 'Repairs and maintenance'],
    ['utilities', 'Utilities'], ['payrollAdmin', 'Payroll and administration'],
    ['managementFee', 'Management fee'], ['reserves', 'Replacement reserves'],
    ['annualBelowNoiCosts', 'Annual below-NOI costs'], ['incomeGrowth', 'Income growth'],
    ['expenseGrowth', 'Expense growth'],
  );
  if (form.strategy === 'land') requiredReviewed.push(
    ['developmentType', 'Development type'], ['dispositionStrategy', 'Disposition strategy'],
    ['entitlementStatus', 'Entitlement status'],
  );
  const missing = requiredReviewed.find(([field]) => form[field] === '' || form[field] == null);
  if (missing) throw new Error(`${missing[1]} needs review. Enter an explicit value, including 0 where appropriate.`);
  requireRange(form, 'purchasePrice', 'Purchase price', 0, Number.MAX_SAFE_INTEGER, { exclusive: true });
  requireRange(form, 'units', 'Units', 1, 1000000, { integer: true });
  if (form.rentableSquareFeet !== '' && form.rentableSquareFeet != null) {
    requireRange(form, 'rentableSquareFeet', 'Rentable square feet', 0, Number.MAX_SAFE_INTEGER, { exclusive: true });
  }
  requireRange(form, 'holdMonths', 'Hold period', 1, 600, { integer: true });
  requireRange(form, 'ltv', 'Loan-to-value or loan-to-cost', 0, 200);
  requireRange(form, 'interestRate', 'Interest rate', 0, 100);
  requireRange(form, 'sellingCosts', 'Selling costs', 0, 50);
  requireRange(form, 'originationFee', 'Origination fee', 0, 25);
  requireRange(form, 'discountRate', 'Discount rate', -99, 500, { exclusive: true });
  if (Number(form.ltv) > 0) {
    requireRange(form, 'amortizationYears', 'Amortization', 1, 50, { integer: true });
    requireRange(form, 'loanTermYears', 'Loan term', 1, 50, { integer: true });
    requireRange(form, 'interestOnlyMonths', 'Interest-only period', 0, 600, { integer: true });
    if (Number(form.interestOnlyMonths) > Number(form.loanTermYears) * 12) {
      throw new Error('Interest-only period cannot exceed the loan term.');
    }
  }
  if (form.strategy === 'rental') {
    requireRange(form, 'annualRent', 'Annual scheduled rent', 0, Number.MAX_SAFE_INTEGER, { exclusive: true });
    requireRange(form, 'vacancy', 'Vacancy', 0, 100, { exclusive: false });
    if (Number(form.vacancy) >= 100) throw new Error('Vacancy must be less than 100%.');
    requireRange(form, 'managementFee', 'Management fee', 0, 50);
    requireRange(form, 'incomeGrowth', 'Income growth', -50, 50);
    requireRange(form, 'expenseGrowth', 'Expense growth', -50, 50);
    if (form.explicitSalePrice !== '' && form.explicitSalePrice != null) {
      requireRange(form, 'explicitSalePrice', 'Expected sale price', 0, Number.MAX_SAFE_INTEGER, { exclusive: true });
    } else requireRange(form, 'exitCap', 'Exit cap rate', 0, 50, { exclusive: true });
  } else if (form.strategy === 'flip') {
    requireRange(form, 'arv', 'After-repair value', 0, Number.MAX_SAFE_INTEGER, { exclusive: true });
  } else if (form.strategy === 'land') {
    requireRange(form, 'siteAcres', 'Site area', 0, Number.MAX_SAFE_INTEGER, { exclusive: true });
    requireRange(form, 'parcelCount', 'Parcel count', 1, 1000000, { integer: true });
    requireRange(form, 'developmentMonths', 'Development schedule', 1, 600, { integer: true });
    requireRange(form, 'expectedTerminalValue', 'Expected terminal value', 0, Number.MAX_SAFE_INTEGER);
  }
  if (form.strategy === 'flip') requireRange(form, 'rehabContingency', 'Rehab contingency', 0, 100);
  if (form.strategy === 'land') requireRange(form, 'landContingency', 'Construction contingency', 0, 100);
};

const driverBounds = {
  rent_change: [-0.9, 5], operating_expense_change: [-0.9, 5],
  after_repair_value_change: [-0.9, 5], rehab_cost_change: [-0.9, 5],
  terminal_value_change: [-0.9, 5], development_cost_change: [-0.9, 5],
  vacancy_rate: [0, 0.95], exit_cap_rate: [0.001, 0.5], interest_rate: [0, 1],
};

export const validateMonteCarloScenarios = (scenarios) => {
  for (const scenario of scenarios) {
    if (!Number.isInteger(scenario.iterations) || scenario.iterations < 250 || scenario.iterations > 20000) {
      throw new Error('Iterations per case must be a whole number from 250 to 20,000.');
    }
    for (const [name, driver] of Object.entries(scenario.drivers)) {
      if (![driver.minimum, driver.mode, driver.maximum].every(Number.isFinite)
          || driver.minimum > driver.mode || driver.mode > driver.maximum) {
        throw new Error(`${name.replaceAll('_', ' ')} must be ordered low ≤ mode ≤ high in ${scenario.name}.`);
      }
      const [minimum, maximum] = driverBounds[name] || [-Infinity, Infinity];
      if (driver.minimum < minimum || driver.maximum > maximum) {
        throw new Error(`${name.replaceAll('_', ' ')} must stay between ${minimum} and ${maximum} in ${scenario.name}.`);
      }
    }
  }
};

export const responseErrorMessage = (error, fallback) => {
  const detail = error.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((item) => item.msg).filter(Boolean).join(' ') || fallback;
  return error.message || fallback;
};
