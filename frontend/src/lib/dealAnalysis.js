const FORMULA_VERSION = 'diamond-underwriting-web-1.1.0';

const clean = (value, digits = 8) => value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits));
const ratio = (numerator, denominator) => Math.abs(denominator) < 1e-12 ? null : clean(numerator / denominator);
const metric = (value, unit, formula, components = {}, warning = null) => ({ value: clean(value), unit, formula, components, warning });

const periodicPayment = (principal, periodicRate, periods) => {
  if (principal <= 0 || periods <= 0) return 0;
  if (periodicRate === 0) return principal / periods;
  const growth = (1 + periodicRate) ** periods;
  return principal * periodicRate * growth / (growth - 1);
};

const loanSchedule = (loan, purchasePrice, projectionMonths) => {
  const principal = loan.principal || purchasePrice * (loan.loan_to_value || 0);
  const rate = (loan.annual_interest_rate || 0) / 12;
  const ioMonths = loan.interest_only_months || 0;
  const termMonths = loan.term_months || 360;
  const amortizationMonths = Math.max((loan.amortization_years || 30) * 12 - ioMonths, 1);
  const payment = periodicPayment(principal, rate, amortizationMonths);
  let balance = principal;
  const rows = [];
  for (let month = 1; month <= projectionMonths; month += 1) {
    const interest = balance * rate;
    const scheduledPrincipal = month <= ioMonths ? 0 : Math.min(balance, Math.max(payment - interest, 0));
    balance = Math.max(balance - scheduledPrincipal, 0);
    const balloon = month === termMonths ? balance : 0;
    if (balloon) balance = 0;
    rows.push({ debtService: interest + scheduledPrincipal + balloon, interest, scheduledPrincipal, balloon, closingBalance: balance });
  }
  return { principal, rows };
};

const netPresentValue = (cashFlows, annualRate) => {
  const monthlyRate = (1 + annualRate) ** (1 / 12) - 1;
  return cashFlows.reduce((total, value, month) => total + value / ((1 + monthlyRate) ** month), 0);
};

const annualizedIrr = (cashFlows) => {
  if (!cashFlows.some((value) => value < 0) || !cashFlows.some((value) => value > 0)) return null;
  const monthlyNpv = (rate) => cashFlows.reduce((total, value, month) => total + value / ((1 + rate) ** month), 0);
  // -99% is a sufficiently broad monthly lower bound without overflowing
  // long-hold terminal cash flows in browser number arithmetic.
  let low = -0.99;
  let high = 1;
  let lowValue = monthlyNpv(low);
  let highValue = monthlyNpv(high);
  while (lowValue * highValue > 0 && high < 1000000) { high *= 2; highValue = monthlyNpv(high); }
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) return null;
  for (let iteration = 0; iteration < 160; iteration += 1) {
    const midpoint = (low + high) / 2;
    const midpointValue = monthlyNpv(midpoint);
    if (Math.abs(midpointValue) < 1e-8) { low = midpoint; high = midpoint; break; }
    if (lowValue * midpointValue <= 0) high = midpoint;
    else { low = midpoint; lowValue = midpointValue; }
  }
  const annual = (1 + ((low + high) / 2)) ** 12 - 1;
  return Number.isFinite(annual) ? annual : null;
};

const commonMetrics = (request, cashFlows, totalDebt, totalProjectCost) => {
  const values = cashFlows.map((row) => row.net_cash_flow);
  const contributions = Math.abs(values.reduce((total, value) => total + Math.min(value, 0), 0));
  const distributions = values.reduce((total, value) => total + Math.max(value, 0), 0);
  const irr = annualizedIrr(values);
  return {
    irr: metric(irr, 'decimal_rate', 'annualized monthly IRR where NPV(cash flows) = 0', {}, irr == null ? 'IRR is undefined because the cash flows contain no positive distribution.' : null),
    npv: metric(netPresentValue(values, request.assumptions?.annual_discount_rate || 0), request.property.currency, 'sum(monthly cash flow / (1 + annual discount rate)^(month/12))', { annual_discount_rate: request.assumptions?.annual_discount_rate || 0 }),
    equity_multiple: metric(ratio(distributions, contributions), 'multiple', 'total positive equity distributions / total equity contributions', { distributions, equity_contributions: contributions }),
    ltv: metric(ratio(totalDebt, request.acquisition.purchase_price), 'decimal_rate', 'total initial debt / purchase price', { total_debt: totalDebt, purchase_price: request.acquisition.purchase_price }),
    ltc: metric(ratio(totalDebt, totalProjectCost), 'decimal_rate', 'total initial debt / total initial project cost', { total_debt: totalDebt, total_project_cost: totalProjectCost }),
  };
};

const analyzeRental = (request, schedules, totalDebt, originationFees) => {
  const { acquisition, operating } = request;
  const totalProjectCost = acquisition.purchase_price + acquisition.closing_costs + acquisition.due_diligence_costs + acquisition.initial_capex;
  const initialEquity = totalProjectCost + originationFees - totalDebt;
  if (initialEquity <= 0) throw new Error('Initial debt and loan proceeds must leave a positive equity contribution.');
  const cashFlows = [{ month: 0, operating_cash_flow: 0, debt_service: 0, capital_costs: totalProjectCost + originationFees, sale_proceeds: 0, loan_payoff: 0, net_cash_flow: -initialEquity }];
  const monthlyNoi = []; const monthlyEgi = []; const monthlyOpex = []; const monthlyCapital = [];
  const monthDebtService = (month) => schedules.reduce((sum, schedule) => sum + schedule.rows[month - 1].debtService, 0);
  const endingDebt = (month) => schedules.reduce((sum, schedule) => sum + schedule.rows[month - 1].closingBalance, 0);
  for (let month = 1; month <= acquisition.hold_months; month += 1) {
    const yearIndex = Math.floor((month - 1) / 12);
    const incomeFactor = (1 + operating.annual_income_growth_rate) ** yearIndex;
    const expenseFactor = (1 + operating.annual_expense_growth_rate) ** yearIndex;
    const annualEgi = operating.gross_scheduled_rent * incomeFactor * (1 - operating.vacancy_rate - (operating.credit_loss_rate || 0)) + operating.other_income * incomeFactor;
    const fixedOpex = operating.operating_expenses * expenseFactor;
    const management = annualEgi * operating.management_fee_rate;
    const annualNoi = annualEgi - fixedOpex - management;
    const annualCapital = (operating.replacement_reserves + operating.annual_below_noi_costs) * expenseFactor;
    const debtService = monthDebtService(month);
    const operatingCash = annualNoi / 12;
    const capitalCosts = annualCapital / 12;
    cashFlows.push({ month, operating_cash_flow: clean(operatingCash), debt_service: clean(debtService), capital_costs: clean(capitalCosts), sale_proceeds: 0, loan_payoff: 0, net_cash_flow: clean(operatingCash - capitalCosts - debtService) });
    monthlyNoi.push(annualNoi / 12); monthlyEgi.push(annualEgi / 12); monthlyOpex.push((fixedOpex + management) / 12); monthlyCapital.push(capitalCosts);
  }
  const hold = acquisition.hold_months;
  const terminalYear = Math.floor(hold / 12);
  const terminalIncomeFactor = (1 + operating.annual_income_growth_rate) ** terminalYear;
  const terminalExpenseFactor = (1 + operating.annual_expense_growth_rate) ** terminalYear;
  const terminalEgi = operating.gross_scheduled_rent * terminalIncomeFactor * (1 - operating.vacancy_rate - (operating.credit_loss_rate || 0)) + operating.other_income * terminalIncomeFactor;
  const terminalNoi = terminalEgi - operating.operating_expenses * terminalExpenseFactor - terminalEgi * operating.management_fee_rate;
  const explicitSalePrice = request.exit.explicit_sale_price || 0;
  const exitCap = request.exit.exit_cap_rate || 0;
  const salePrice = Math.max(0, explicitSalePrice || (exitCap > 0 ? terminalNoi / exitCap : 0));
  const sellingCosts = salePrice * request.exit.selling_cost_rate;
  const loanPayoff = endingDebt(hold);
  const last = cashFlows[cashFlows.length - 1];
  last.sale_proceeds = clean(salePrice - sellingCosts); last.loan_payoff = clean(loanPayoff);
  last.net_cash_flow = clean(last.net_cash_flow + salePrice - sellingCosts - loanPayoff);
  const yearOneMonths = Math.min(12, hold);
  const annualize = (values) => values.slice(0, yearOneMonths).reduce((sum, value) => sum + value, 0) * (12 / yearOneMonths);
  const yearOneNoi = annualize(monthlyNoi); const yearOneEgi = annualize(monthlyEgi);
  const yearOneOpex = annualize(monthlyOpex); const yearOneCapital = annualize(monthlyCapital);
  const yearOneDebtService = Array.from({ length: yearOneMonths }, (_, index) => monthDebtService(index + 1)).reduce((sum, value) => sum + value, 0) * (12 / yearOneMonths);
  const yearOneEquityCash = yearOneNoi - yearOneCapital - yearOneDebtService;
  const grossRent = operating.gross_scheduled_rent;
  const requiredEgi = (operating.operating_expenses + operating.replacement_reserves + operating.annual_below_noi_costs + yearOneDebtService) / Math.max(1 - operating.management_fee_rate, 1e-12);
  const breakEven = grossRent > 0 ? ratio(Math.max(requiredEgi - operating.other_income, 0), grossRent * (1 - (operating.credit_loss_rate || 0))) : null;
  const metrics = commonMetrics(request, cashFlows, totalDebt, totalProjectCost);
  Object.assign(metrics, {
    noi: metric(yearOneNoi, `${request.property.currency}/year`, 'effective gross income - operating expenses - management fee', { effective_gross_income: yearOneEgi, operating_expenses: yearOneOpex }),
    cap_rate: metric(ratio(yearOneNoi, acquisition.purchase_price), 'decimal_rate', 'year-one NOI / purchase price', { noi: yearOneNoi, purchase_price: acquisition.purchase_price }),
    cash_on_cash: metric(ratio(yearOneEquityCash, initialEquity), 'decimal_rate', 'year-one pre-tax equity cash flow / initial equity', { year_one_equity_cash_flow: yearOneEquityCash, initial_equity: initialEquity }),
    dscr: metric(ratio(yearOneNoi, yearOneDebtService), 'ratio', 'year-one NOI / year-one debt service', { noi: yearOneNoi, debt_service: yearOneDebtService }, yearOneDebtService ? null : 'DSCR is undefined because the deal has no debt service.'),
    debt_yield: metric(ratio(yearOneNoi, totalDebt), 'decimal_rate', 'year-one NOI / total initial debt', { noi: yearOneNoi, total_debt: totalDebt }, totalDebt ? null : 'Debt yield is undefined because the deal has no debt.'),
    break_even_occupancy: metric(breakEven, 'decimal_rate', 'required rent collection / gross scheduled rent', { required_egi: requiredEgi, gross_scheduled_rent: grossRent }, grossRent ? null : 'Break-even occupancy is undefined because scheduled rent is zero.'),
    sale_price: metric(salePrice, request.property.currency, 'explicit terminal value or terminal NOI / exit cap rate', { terminal_noi: terminalNoi, exit_cap_rate: exitCap }),
  });
  const warnings = ['Calculated securely in this browser; no live analysis service was required.'];
  if (operating.gross_scheduled_rent === 0 && operating.other_income === 0) warnings.push('No operating income was entered, so year-one NOI is $0 before any expenses.');
  if (salePrice === 0) warnings.push('No terminal value can be calculated: enter an expected sale price or a positive exit cap rate with positive terminal NOI. The model therefore assumes $0 disposition proceeds.');
  if (metrics.irr.value == null) warnings.push('IRR is mathematically undefined because the modeled cash flows contain no positive distribution.');
  if (request.property.unit_count > 1 && request.property.property_type === 'single_family') warnings.push('Multiple planned homes are treated as one investment; zoning capacity is not proof that units exist or that construction is feasible.');
  return { analysis_id: `browser-${Date.now()}`, schema_version: '1.0', formula_version: FORMULA_VERSION, strategy: 'rental', computed_at: new Date().toISOString(), metrics, cash_flows: cashFlows, calculation_mode: 'browser', assumptions: { timing: 'Monthly operations with disposition after the final month.', taxes: 'Income taxes, depreciation, and entity-level tax effects are not modeled.' }, warnings };
};

const analyzeFlip = (request, schedules, totalDebt, originationFees) => {
  const { acquisition, flip } = request;
  const rehab = flip.rehab_cost * (1 + flip.rehab_contingency_rate);
  const totalProjectCost = acquisition.purchase_price + acquisition.closing_costs + acquisition.due_diligence_costs + acquisition.initial_capex + rehab + flip.other_project_costs;
  const initialEquity = totalProjectCost + originationFees - totalDebt;
  if (initialEquity <= 0) throw new Error('Initial debt and loan proceeds must leave a positive equity contribution.');
  const cashFlows = [{ month: 0, operating_cash_flow: 0, debt_service: 0, capital_costs: totalProjectCost + originationFees, sale_proceeds: 0, loan_payoff: 0, net_cash_flow: -initialEquity }];
  for (let month = 1; month <= acquisition.hold_months; month += 1) {
    const debtService = schedules.reduce((sum, schedule) => sum + schedule.rows[month - 1].debtService, 0);
    cashFlows.push({ month, operating_cash_flow: 0, debt_service: debtService, capital_costs: flip.monthly_holding_costs, sale_proceeds: 0, loan_payoff: 0, net_cash_flow: -flip.monthly_holding_costs - debtService });
  }
  const salePrice = request.exit.explicit_sale_price || flip.after_repair_value;
  const sellingCosts = salePrice * request.exit.selling_cost_rate;
  const loanPayoff = schedules.reduce((sum, schedule) => sum + schedule.rows[acquisition.hold_months - 1].closingBalance, 0);
  const last = cashFlows[cashFlows.length - 1];
  last.sale_proceeds = salePrice - sellingCosts; last.loan_payoff = loanPayoff; last.net_cash_flow += salePrice - sellingCosts - loanPayoff;
  const profit = cashFlows.reduce((sum, row) => sum + row.net_cash_flow, 0);
  const contributions = initialEquity + cashFlows.slice(1).reduce((sum, row) => sum + row.capital_costs + row.debt_service, 0);
  const metrics = commonMetrics(request, cashFlows, totalDebt, totalProjectCost);
  Object.assign(metrics, {
    flip_profit: metric(profit, request.property.currency, 'sum of all project equity cash flows, including net sale proceeds', { sale_price: salePrice, selling_costs: sellingCosts, equity_contributions: contributions }),
    flip_roi: metric(ratio(profit, contributions), 'decimal_rate', 'flip profit / total equity contributions', { profit, equity_contributions: contributions }),
    max_offer_70_rule: metric(flip.after_repair_value * 0.7 - rehab, request.property.currency, '70% of after-repair value - rehab with contingency', { after_repair_value: flip.after_repair_value, rehab_with_contingency: rehab }, 'The 70% rule is a screening heuristic, not a valuation.'),
  });
  const warnings = ['Calculated securely in this browser; no live analysis service was required.', 'After-repair value, construction budget, and timeline are user assumptions and require independent verification.'];
  if (salePrice === 0) warnings.push('No after-repair value was entered, so the model assumes $0 disposition proceeds.');
  return { analysis_id: `browser-${Date.now()}`, schema_version: '1.0', formula_version: FORMULA_VERSION, strategy: 'flip', computed_at: new Date().toISOString(), metrics, cash_flows: cashFlows, calculation_mode: 'browser', assumptions: { timing: 'Holding and debt costs occur monthly; sale occurs after the final month.' }, warnings };
};

const analyzeLand = (request, schedules, totalDebt, originationFees) => {
  const { acquisition, land } = request;
  const acquisitionCost = acquisition.purchase_price + acquisition.closing_costs + acquisition.due_diligence_costs + acquisition.initial_capex;
  const contingencyBasis = land.site_work_cost + land.hard_construction_cost;
  const contingency = contingencyBasis * land.contingency_rate;
  const developmentCosts = land.site_work_cost + land.hard_construction_cost + land.soft_costs + land.permits_impact_fees + land.environmental_remediation + land.developer_fee + contingency;
  const totalProjectCost = acquisitionCost + developmentCosts;
  const initialEquity = totalProjectCost + originationFees - totalDebt;
  if (initialEquity <= 0) throw new Error('Construction financing must leave a positive equity contribution.');

  const monthDebtService = (month) => schedules.reduce((sum, schedule) => sum + schedule.rows[month - 1].debtService, 0);
  const endingDebt = (month) => schedules.reduce((sum, schedule) => sum + schedule.rows[month - 1].closingBalance, 0);
  const monthlyCarrying = land.annual_carrying_costs / 12;
  const cashFlows = [{ month: 0, operating_cash_flow: 0, debt_service: 0, capital_costs: totalProjectCost + originationFees, sale_proceeds: 0, loan_payoff: 0, net_cash_flow: -initialEquity }];
  for (let month = 1; month <= acquisition.hold_months; month += 1) {
    const debtService = monthDebtService(month);
    cashFlows.push({ month, operating_cash_flow: 0, debt_service: clean(debtService), capital_costs: clean(monthlyCarrying), sale_proceeds: 0, loan_payoff: 0, net_cash_flow: clean(-monthlyCarrying - debtService) });
  }

  const derivedTerminalValue = land.stabilized_noi > 0 && land.stabilized_exit_cap_rate > 0 ? land.stabilized_noi / land.stabilized_exit_cap_rate : 0;
  const terminalValue = Math.max(0, land.expected_terminal_value || derivedTerminalValue);
  const sellingCosts = terminalValue * request.exit.selling_cost_rate;
  const loanPayoff = endingDebt(acquisition.hold_months);
  const last = cashFlows[cashFlows.length - 1];
  last.sale_proceeds = clean(terminalValue - sellingCosts); last.loan_payoff = clean(loanPayoff);
  last.net_cash_flow = clean(last.net_cash_flow + terminalValue - sellingCosts - loanPayoff);

  const values = cashFlows.map((row) => row.net_cash_flow);
  const profit = values.reduce((sum, value) => sum + value, 0);
  const equityContributions = Math.abs(values.reduce((sum, value) => sum + Math.min(value, 0), 0));
  const totalInterest = schedules.reduce((sum, schedule) => sum + schedule.rows.reduce((rowSum, row) => rowSum + row.interest, 0), 0);
  const totalCarrying = monthlyCarrying * acquisition.hold_months;
  const economicCost = totalProjectCost + originationFees + totalInterest + totalCarrying;
  const breakEvenTerminalValue = request.exit.selling_cost_rate < 1 ? economicCost / (1 - request.exit.selling_cost_rate) : null;
  const nonLandCosts = totalProjectCost - acquisition.purchase_price;
  const residualLandValue = terminalValue * (1 - request.exit.selling_cost_rate) * (1 - land.target_profit_margin) - nonLandCosts - totalInterest - totalCarrying;
  const metrics = commonMetrics(request, cashFlows, totalDebt, totalProjectCost);
  Object.assign(metrics, {
    development_profit: metric(profit, request.property.currency, 'net disposition proceeds - equity contributions - carrying and financing costs', { terminal_value: terminalValue, selling_costs: sellingCosts, economic_cost: economicCost }),
    development_roi: metric(ratio(profit, equityContributions), 'decimal_rate', 'development profit / total equity contributions', { profit, equity_contributions: equityContributions }),
    development_margin: metric(ratio(profit, terminalValue), 'decimal_rate', 'development profit / gross terminal value', { profit, terminal_value: terminalValue }, terminalValue ? null : 'Development margin is undefined without a terminal value.'),
    total_development_cost: metric(totalProjectCost, request.property.currency, 'land acquisition + transaction + site + hard + soft + entitlement + environmental + developer fee + contingency', { acquisition_cost: acquisitionCost, development_costs: developmentCosts, contingency }),
    residual_land_value: metric(residualLandValue, request.property.currency, 'net terminal value after target margin less all non-land, carrying, and financing costs', { terminal_value: terminalValue, target_profit_margin: land.target_profit_margin, non_land_costs: nonLandCosts }),
    break_even_terminal_value: metric(breakEvenTerminalValue, request.property.currency, 'total economic cost / (1 - selling cost rate)', { economic_cost: economicCost, selling_cost_rate: request.exit.selling_cost_rate }),
    cost_per_acre: metric(ratio(totalProjectCost, land.site_acres), `${request.property.currency}/acre`, 'total development cost / site acres', { total_project_cost: totalProjectCost, site_acres: land.site_acres }),
    cost_per_unit: metric(ratio(totalProjectCost, land.planned_units), `${request.property.currency}/unit`, 'total development cost / planned units', { total_project_cost: totalProjectCost, planned_units: land.planned_units }),
    cost_per_buildable_sf: metric(ratio(totalProjectCost, land.buildable_square_feet), `${request.property.currency}/sf`, 'total development cost / buildable square feet', { total_project_cost: totalProjectCost, buildable_square_feet: land.buildable_square_feet }),
  });

  const warnings = ['Calculated securely in this browser; no live analysis service was required.', 'Land-development results depend on zoning, entitlement, utility, environmental, geotechnical, civil, market, and construction assumptions that require professional verification.'];
  if (!terminalValue) warnings.push('No terminal value can be calculated. Enter an expected gross exit value or stabilized NOI with a capitalization rate.');
  if (land.development_months + (land.absorption_months || 0) > acquisition.hold_months) warnings.push('Development plus sales / lease-up absorption exceeds the modeled hold period.');
  if (land.entitlement_status === 'unentitled' || land.entitlement_status === 'rezoning_required') warnings.push('The project carries material entitlement risk; probability, timing, and denial costs are not independently estimated.');
  if (land.utility_status !== 'available') warnings.push('Water, sewer, power, stormwater, and other utility capacity are not confirmed at the site; extensions and off-site upgrades may materially change cost and timing.');
  if (land.access_status !== 'legal_confirmed') warnings.push('Legal and physical access is not confirmed; verify frontage, curb cuts, easements, and emergency access.');
  if (land.environmental_status !== 'clear') warnings.push('Environmental diligence is incomplete or indicates a recognized condition; complete Phase I/II review and quantify remediation.');
  if (land.geotechnical_status !== 'complete_suitable') warnings.push('Geotechnical suitability is not confirmed; soils, rock, groundwater, slope, and foundation conditions may affect feasibility.');
  if (land.flood_zone && land.flood_zone.trim().toUpperCase() !== 'X') warnings.push('The entered flood-zone designation requires floodplain, stormwater, elevation, insurance, and buildable-area review.');
  if ((land.wetlands_acres || 0) > 0) warnings.push('Wetlands were entered; verify delineation, buffers, mitigation, permitting, and the resulting net buildable area.');
  if (residualLandValue < acquisition.purchase_price) warnings.push('The modeled residual land value is below the proposed purchase price at the selected target margin.');
  if (land.planned_units < 1 && land.buildable_square_feet < 1) warnings.push('Enter planned units or buildable square feet to evaluate density and unit economics.');

  return { analysis_id: `browser-${Date.now()}`, schema_version: '1.0', formula_version: FORMULA_VERSION, strategy: 'land', computed_at: new Date().toISOString(), metrics, cash_flows: cashFlows, calculation_mode: 'browser', assumptions: { cost_timing: 'Development uses are treated as committed at acquisition; carrying costs and debt service occur monthly.', terminal_value: 'Uses explicit exit value first, otherwise stabilized NOI divided by exit cap rate.', taxes: 'Income taxes, depreciation, tax credits, and entity-level tax effects are not modeled.' }, warnings };
};

export const analyzeDealLocally = (request) => {
  if (!(request.acquisition.purchase_price > 0)) throw new Error('Purchase price must be greater than zero.');
  const schedules = (request.debt || []).map((loan) => loanSchedule(loan, request.acquisition.purchase_price, request.acquisition.hold_months));
  const totalDebt = schedules.reduce((sum, schedule) => sum + schedule.principal, 0);
  const originationFees = schedules.reduce((sum, schedule, index) => sum + schedule.principal * (request.debt[index].origination_fee_rate || 0), 0);
  if (request.strategy === 'rental') return analyzeRental(request, schedules, totalDebt, originationFees);
  if (request.strategy === 'land') return analyzeLand(request, schedules, totalDebt, originationFees);
  return analyzeFlip(request, schedules, totalDebt, originationFees);
};

const seededRandom = (seed) => { let state = seed >>> 0; return () => { state = (1664525 * state + 1013904223) >>> 0; return state / 4294967296; }; };
const triangular = (random, distribution) => {
  const { minimum, mode, maximum } = distribution;
  if (maximum === minimum) return minimum;
  const u = random(); const split = (mode - minimum) / (maximum - minimum);
  return u < split ? minimum + Math.sqrt(u * (maximum - minimum) * (mode - minimum)) : maximum - Math.sqrt((1 - u) * (maximum - minimum) * (maximum - mode));
};
const percentile = (sorted, p) => { if (!sorted.length) return null; const position = (sorted.length - 1) * p; const lower = Math.floor(position); const upper = Math.ceil(position); return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower); };
const summarize = (values) => {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length) return { mean: null, minimum: null, p10: null, p25: null, p50: null, p75: null, p90: null, maximum: null, probability_above_zero: 0, probability_below_one: 0 };
  return { mean: valid.reduce((sum, value) => sum + value, 0) / valid.length, minimum: valid[0], p10: percentile(valid, .1), p25: percentile(valid, .25), p50: percentile(valid, .5), p75: percentile(valid, .75), p90: percentile(valid, .9), maximum: valid[valid.length - 1], probability_above_zero: valid.filter((value) => value > 0).length / valid.length, probability_below_one: valid.filter((value) => value < 1).length / valid.length };
};

export const runMonteCarloLocally = ({ deal, scenarios }) => ({
  formula_version: FORMULA_VERSION,
  scenarios: scenarios.map((scenario) => {
    const iterations = Math.min(scenario.iterations, 5000); const random = seededRandom(scenario.seed); const values = {};
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const shocked = JSON.parse(JSON.stringify(deal));
      Object.entries(scenario.drivers).forEach(([driver, distribution]) => {
        const draw = triangular(random, distribution);
        if (driver === 'rent_change') shocked.operating.gross_scheduled_rent *= 1 + draw;
        if (driver === 'vacancy_rate') shocked.operating.vacancy_rate = draw;
        if (driver === 'operating_expense_change') shocked.operating.operating_expenses *= 1 + draw;
        if (driver === 'exit_cap_rate') shocked.exit.exit_cap_rate = draw;
        if (driver === 'interest_rate') shocked.debt.forEach((loan) => { loan.annual_interest_rate = draw; });
        if (driver === 'after_repair_value_change') shocked.flip.after_repair_value *= 1 + draw;
        if (driver === 'rehab_cost_change') shocked.flip.rehab_cost *= 1 + draw;
        if (driver === 'terminal_value_change') {
          if (shocked.land.expected_terminal_value > 0) shocked.land.expected_terminal_value *= 1 + draw;
          else shocked.land.stabilized_noi *= 1 + draw;
        }
        if (driver === 'development_cost_change') {
          ['site_work_cost', 'hard_construction_cost', 'soft_costs', 'permits_impact_fees', 'environmental_remediation', 'developer_fee'].forEach((key) => { shocked.land[key] *= 1 + draw; });
        }
      });
      const analysis = analyzeDealLocally(shocked);
      Object.entries(analysis.metrics).forEach(([key, item]) => { if (!values[key]) values[key] = []; if (Number.isFinite(item.value)) values[key].push(item.value); });
    }
    return { name: scenario.name, iterations_requested: scenario.iterations, iterations_completed: iterations, failed_iterations: 0, seed: scenario.seed, summaries: Object.fromEntries(Object.entries(values).map(([key, items]) => [key, summarize(items)])), warnings: scenario.iterations > iterations ? ['Browser simulation capped at 5,000 iterations for responsiveness.'] : [] };
  }),
});
