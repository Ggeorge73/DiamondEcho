const numericFields = [
  'units', 'rentableSquareFeet', 'purchasePrice', 'closingCosts', 'dueDiligenceCosts',
  'initialCapex', 'holdMonths', 'ltv', 'interestRate', 'amortizationYears',
  'interestOnlyMonths', 'loanTermYears', 'originationFee', 'sellingCosts',
  'discountRate', 'annualRent', 'otherIncome', 'vacancy', 'propertyTaxes',
  'insurance', 'repairsMaintenance', 'utilities', 'payrollAdmin', 'managementFee',
  'reserves', 'annualBelowNoiCosts', 'incomeGrowth', 'expenseGrowth', 'exitCap',
  'explicitSalePrice', 'arv', 'rehabCost', 'rehabContingency', 'rehabFinanced', 'monthlyHolding',
  'flipAnnualTaxes', 'flipAnnualInsurance', 'flipMonthlyUtilities', 'compSoldPerSf',
  'lastSalePrice', 'originalListPrice', 'daysOnMarket',
  'otherProjectCosts', 'siteAcres', 'parcelCount', 'wetlandsAcres',
  'developmentMonths', 'absorptionMonths', 'siteWorkCost', 'hardConstructionCost',
  'softCosts', 'permitsImpactFees', 'environmentalRemediation', 'developerFee',
  'landContingency', 'annualCarryingCosts', 'expectedTerminalValue',
  'stabilizedNoi', 'stabilizedExitCap', 'targetProfitMargin', 'mcIterations',
  'mcRentMin', 'mcRentMode', 'mcRentMax', 'mcVacancyMin', 'mcVacancyMode',
  'mcVacancyMax', 'mcExpenseMin', 'mcExpenseMode', 'mcExpenseMax',
  'mcExitCapMin', 'mcExitCapMode', 'mcExitCapMax', 'mcInterestMin',
  'mcInterestMode', 'mcInterestMax', 'mcArvMin', 'mcArvMode', 'mcArvMax',
  'mcRehabMin', 'mcRehabMode', 'mcRehabMax', 'mcHoldMin', 'mcHoldMode', 'mcHoldMax', 'targetCashOnCash', 'minimumDscr',
  'targetIrr', 'preliminaryMarketCeiling', 'maxImmediateCapex',
  'maxAnnualTaxes', 'maxAnnualInsurance', 'flipMinimumProfit', 'flipTargetRoi',
];

// What each box is called on the page, so a message names the box the visitor
// sees and never a field key (item 6 of the 2026-10-26 review).
export const FIELD_LABELS = {
  units: 'Units', rentableSquareFeet: 'Rentable square feet', purchasePrice: 'Purchase price',
  closingCosts: 'Closing costs', dueDiligenceCosts: 'Due diligence', initialCapex: 'Initial capital work',
  holdMonths: 'Hold period', ltv: 'Loan-to-value', interestRate: 'Interest rate', amortizationYears: 'Amortization',
  interestOnlyMonths: 'Interest-only period', loanTermYears: 'Loan term', originationFee: 'Origination fee',
  sellingCosts: 'Selling costs', discountRate: 'Discount rate', annualRent: 'Annual scheduled rent',
  otherIncome: 'Other annual income', vacancy: 'Vacancy', propertyTaxes: 'Property taxes', insurance: 'Insurance',
  repairsMaintenance: 'Repairs and maintenance', utilities: 'Utilities', payrollAdmin: 'Payroll and administration',
  managementFee: 'Management fee', reserves: 'Replacement reserves', annualBelowNoiCosts: 'TI, leasing and capital costs',
  incomeGrowth: 'Income growth', expenseGrowth: 'Expense growth', exitCap: 'Exit cap rate',
  explicitSalePrice: 'Expected sale price', arv: 'After-repair value', rehabCost: 'Rehabilitation budget',
  rehabContingency: 'Rehab contingency', rehabFinanced: 'Rehab financed by the loan', monthlyHolding: 'Monthly holding costs',
  flipAnnualTaxes: 'Annual property taxes', flipAnnualInsurance: 'Annual insurance', flipMonthlyUtilities: 'Monthly utilities',
  compSoldPerSf: 'Renovated comparable sales', lastSalePrice: 'Last sale price', originalListPrice: 'Original list price',
  daysOnMarket: 'Days on market', otherProjectCosts: 'Other project costs', siteAcres: 'Site area',
  parcelCount: 'Parcel count', wetlandsAcres: 'Wetlands area', developmentMonths: 'Development schedule',
  absorptionMonths: 'Sales / lease-up absorption', siteWorkCost: 'Site work and infrastructure',
  hardConstructionCost: 'Hard construction cost', softCosts: 'Soft costs', permitsImpactFees: 'Permits and impact fees',
  environmentalRemediation: 'Environmental / remediation', developerFee: 'Developer fee',
  landContingency: 'Construction contingency', annualCarryingCosts: 'Annual taxes and carrying',
  expectedTerminalValue: 'Expected gross terminal value', stabilizedNoi: 'Stabilized NOI', stabilizedExitCap: 'Stabilized exit cap',
  targetProfitMargin: 'Target development margin', mcIterations: 'Iterations per case',
  mcRentMin: 'Rent change · low', mcRentMode: 'Rent change · mode', mcRentMax: 'Rent change · high',
  mcVacancyMin: 'Vacancy · low', mcVacancyMode: 'Vacancy · mode', mcVacancyMax: 'Vacancy · high',
  mcExpenseMin: 'Expense change · low', mcExpenseMode: 'Expense change · mode', mcExpenseMax: 'Expense change · high',
  mcExitCapMin: 'Exit cap · low', mcExitCapMode: 'Exit cap · mode', mcExitCapMax: 'Exit cap · high',
  mcInterestMin: 'Interest rate · low', mcInterestMode: 'Interest rate · mode', mcInterestMax: 'Interest rate · high',
  mcArvMin: 'Value change · low', mcArvMode: 'Value change · mode', mcArvMax: 'Value change · high',
  mcRehabMin: 'Cost overrun · low', mcRehabMode: 'Cost overrun · mode', mcRehabMax: 'Cost overrun · high',
  mcHoldMin: 'Hold period change · low', mcHoldMode: 'Hold period change · mode', mcHoldMax: 'Hold period change · high',
  targetCashOnCash: 'Target cash-on-cash', minimumDscr: 'Minimum DSCR', targetIrr: 'Target levered IRR',
  preliminaryMarketCeiling: 'Market-value ceiling', maxImmediateCapex: 'Maximum immediate capital work',
  maxAnnualTaxes: 'Maximum annual taxes', maxAnnualInsurance: 'Maximum annual insurance',
  flipMinimumProfit: 'Minimum profit', flipTargetRoi: 'Minimum return on cash',
};
// The same box is called something else on the land tab.
const fieldLabel = (form, field) => (form.strategy === 'land' && field === 'rentableSquareFeet' ? 'Buildable square feet'
  : form.strategy === 'land' && field === 'units' ? 'Planned units / lots'
    : FIELD_LABELS[field] || field);

// A bound of Number.MAX_SAFE_INTEGER means "no upper limit" and is never
// shown; the message then says only what the lower bound is.
const requireRange = (form, field, label, minimum, maximum, { integer = false, exclusive = false } = {}) => {
  const value = Number(form[field]);
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value))
      || (exclusive ? value <= minimum : value < minimum) || value > maximum) {
    const whole = integer ? ', in whole numbers' : '';
    if (maximum >= Number.MAX_SAFE_INTEGER) {
      throw new Error(exclusive ? `${label} must be greater than ${minimum}${whole}.` : `${label} must be ${minimum} or more${whole}.`);
    }
    throw new Error(`${label} must be ${exclusive ? 'greater than' : 'at least'} ${minimum} and no more than ${maximum}${whole}.`);
  }
};

export const validateDealForm = (form) => {
  for (const field of numericFields) {
    if (form[field] !== undefined && form[field] !== '' && !Number.isFinite(Number(form[field]))) {
      throw new Error(`${fieldLabel(form, field)} must be a number.`);
    }
  }
  for (const field of ['closingCosts', 'dueDiligenceCosts', 'initialCapex', 'otherIncome',
    'propertyTaxes', 'insurance', 'repairsMaintenance', 'utilities', 'payrollAdmin',
    'reserves', 'annualBelowNoiCosts', 'rehabCost', 'monthlyHolding', 'otherProjectCosts',
    'wetlandsAcres', 'absorptionMonths', 'siteWorkCost', 'hardConstructionCost',
    'softCosts', 'permitsImpactFees', 'environmentalRemediation', 'developerFee',
    'annualCarryingCosts', 'stabilizedNoi', 'flipAnnualTaxes', 'flipAnnualInsurance',
    'flipMonthlyUtilities', 'compSoldPerSf', 'lastSalePrice', 'originalListPrice', 'daysOnMarket']) {
    if (Number(form[field] || 0) < 0) throw new Error(`${fieldLabel(form, field)} cannot be negative.`);
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
  requireRange(form, 'units', fieldLabel(form, 'units'), 1, 1000000, { integer: true });
  if (form.rentableSquareFeet !== '' && form.rentableSquareFeet != null) {
    requireRange(form, 'rentableSquareFeet', fieldLabel(form, 'rentableSquareFeet'), 0, Number.MAX_SAFE_INTEGER, { exclusive: true });
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
    requireRange(form, 'absorptionMonths', 'Sales / lease-up absorption', 0, 600, { integer: true });
    // A hold shorter than the build plus the sell-out cannot be modeled; the
    // engines refuse it too (the 2026-10-26 review's second pass).
    if (Number(form.holdMonths) < Number(form.developmentMonths) + Number(form.absorptionMonths || 0)) {
      throw new Error(`Hold period must be at least the development schedule plus the absorption (${Number(form.developmentMonths) + Number(form.absorptionMonths || 0)} months). Lengthen the hold or shorten the schedule.`);
    }
    requireRange(form, 'expectedTerminalValue', 'Expected terminal value', 0, Number.MAX_SAFE_INTEGER);
  }
  if (form.strategy === 'flip') {
    requireRange(form, 'rehabContingency', 'Rehab contingency', 0, 100);
    if (form.rehabFinanced !== undefined) requireRange(form, 'rehabFinanced', 'Rehab financed by the loan', 0, 100);
    if (form.flipMinimumProfit !== undefined) requireRange(form, 'flipMinimumProfit', 'Minimum profit', 0, Number.MAX_SAFE_INTEGER);
    if (form.flipTargetRoi !== undefined) requireRange(form, 'flipTargetRoi', 'Minimum return on cash', 0, 1000);
  }
  if (form.strategy === 'land') requireRange(form, 'landContingency', 'Construction contingency', 0, 100);
};

const driverBounds = {
  rent_change: [-0.9, 5], operating_expense_change: [-0.9, 5],
  after_repair_value_change: [-0.9, 5], rehab_cost_change: [-0.9, 5],
  terminal_value_change: [-0.9, 5], development_cost_change: [-0.9, 5],
  vacancy_rate: [0, 0.95], exit_cap_rate: [0.001, 0.5], interest_rate: [0, 1],
  // Months added to the hold period.
  hold_months_change: [-599, 599],
};

// The simulation never models vacancy above this level. The stress cases scale the
// entered high value up to this cap; a value entered above it must be rejected, not
// quietly replaced, so the inputs on screen always match what was simulated.
export const MONTE_CARLO_VACANCY_CAP_PERCENT = 75;

export const validateMonteCarloForm = (form) => {
  if (form.strategy !== 'rental') return;
  const high = Number(form.mcVacancyMax);
  if (form.mcVacancyMax === '' || !Number.isFinite(high) || high > MONTE_CARLO_VACANCY_CAP_PERCENT) {
    throw new Error(`Vacancy · high must be ${MONTE_CARLO_VACANCY_CAP_PERCENT}% or less. The simulation does not model vacancy above ${MONTE_CARLO_VACANCY_CAP_PERCENT}%.`);
  }
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

// The API reports each rejected input with its location, e.g. ["body", "operating",
// "vacancy_rate"]. Show it, so the message says which input to fix.
const rejectedField = (loc) => (Array.isArray(loc) ? loc : [])
  .filter((part) => typeof part === 'string' && part !== 'body')
  .map((part) => part.replace(/_/g, ' '))
  .join(' › ');

export const responseErrorMessage = (error, fallback) => {
  const detail = error.response?.data?.detail;
  // A sentence from the service starts with a capital letter on the page.
  if (typeof detail === 'string') return detail.charAt(0).toUpperCase() + detail.slice(1);
  if (Array.isArray(detail)) {
    const lines = [...new Set(detail.filter((item) => item?.msg).map((item) => {
      const field = rejectedField(item.loc);
      const message = String(item.msg).replace(/^Value error, /, '');
      return field ? `${field}: ${message}` : message;
    }))];
    if (!lines.length) return fallback;
    const shown = lines.slice(0, 3).join(' · ');
    return lines.length > 3 ? `${shown} · and ${lines.length - 3} more.` : shown;
  }
  // No answer at all from the analysis service: say so, and that nothing was calculated.
  if (error.isAxiosError && !error.response) {
    return 'The analysis service could not be reached, so nothing was calculated. Check your connection and try again.';
  }
  return error.message || fallback;
};
