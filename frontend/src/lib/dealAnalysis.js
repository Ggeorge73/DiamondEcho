import { floodZoneWarning } from './floodZone';

// 1.2.0 (2026-10-06): residual land value is the land price at which the deal
// earns exactly the target development margin; the flood-zone warning reads the
// FEMA designation; Monte Carlo can run in steps so the page stays responsive.
// 1.3.0 (2026-10-22): in a fix-and-flip simulation the rehab contingency absorbs
// a rehab overrun instead of being applied on top of it. The base analysis is
// unchanged.
// 1.4.0 (2026-10-22): in a land-development simulation the contingency on site
// work and hard construction absorbs a development-cost draw instead of being
// applied on top of it. The base analysis is unchanged.
// 1.5.0 (2026-10-22): a flip loan can fund a share of the rehab budget on top of
// loan-to-value times the price (rehab_financed_rate, 0 by default, so earlier
// figures are unchanged), and the simulation can draw the hold period.
// 1.6.0 (2026-10-22): a loan can be sized on the purchase price (the default and
// the earlier behaviour), the total project cost, or a flip's after-repair value
// (loan_basis); the simulation and the stressed cases keep the loan at its base
// size, as a lender does.
// 1.7.0 (2026-10-26): a land development spends its budget over the development
// schedule, draws the facility as it spends and sells over the absorption
// months, so those two inputs now move the figures; the residual land value is
// solved against that schedule. A rental also reports its debt service
// coverage after replacement reserves and TI (dscr_after_reserves), and warns
// when year-one figures are annualized from a hold shorter than a year.
// 1.8.0 (2026-10-26, second pass): a loan whose term ends before the hold does
// is extended to the end of the hold at the same rate, with a warning, instead
// of its balance being paid from the investor's pocket at maturity while the
// property is still held; a land hold shorter than development plus absorption
// is refused instead of compressed.
export const FORMULA_VERSION = 'diamond-underwriting-web-1.8.0';

const clean = (value, digits = 8) => value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits));
const ratio = (numerator, denominator) => Math.abs(denominator) < 1e-12 ? null : clean(numerator / denominator);
const metric = (value, unit, formula, components = {}, warning = null) => ({ value: clean(value), unit, formula, components, warning });

const periodicPayment = (principal, periodicRate, periods) => {
  if (principal <= 0 || periods <= 0) return 0;
  if (periodicRate === 0) return principal / periods;
  const growth = (1 + periodicRate) ** periods;
  return principal * periodicRate * growth / (growth - 1);
};

// Every cost funded at acquisition, before loan fees: the loan basis for
// 'total_project_cost'. Matches the figure each strategy's analysis uses.
export const totalProjectCost = (request) => {
  const { acquisition: a } = request;
  let cost = a.purchase_price + a.closing_costs + a.due_diligence_costs + a.initial_capex;
  if (request.flip) cost += request.flip.rehab_cost * (1 + request.flip.rehab_contingency_rate) + request.flip.other_project_costs;
  if (request.land) {
    const l = request.land;
    cost += l.site_work_cost + l.hard_construction_cost + l.soft_costs + l.permits_impact_fees + l.environmental_remediation + l.developer_fee + (l.site_work_cost + l.hard_construction_cost) * l.contingency_rate;
  }
  return cost;
};
export const loanBasisAmount = (request, loan) => {
  if (loan.loan_basis === 'total_project_cost') return totalProjectCost(request);
  if (loan.loan_basis === 'after_repair_value' && request.flip) return request.flip.after_repair_value;
  return request.acquisition.purchase_price;
};
// The loan amount: as given, or loan-to-value times its basis, plus the
// financed share of a flip's rehab budget when the basis is the price (the
// other bases already carry the rehab). The contingency stays the investor's.
export const loanPrincipal = (request, loan) => {
  if (loan.principal) return loan.principal;
  const financedRehab = request.flip && (loan.loan_basis || 'purchase_price') === 'purchase_price' ? (request.flip.rehab_cost || 0) * (loan.rehab_financed_rate || 0) : 0;
  return loanBasisAmount(request, loan) * (loan.loan_to_value || 0) + financedRehab;
};
const BASIS_WORDS = { purchase_price: 'purchase price', total_project_cost: 'total project cost', after_repair_value: 'after-repair value' };
const loanSizingFormula = (request) => (request.debt || []).length === 0 ? 'no loan' : request.debt.map((loan) => (loan.principal ? 'loan amount as entered' : `loan-to-value x ${BASIS_WORDS[loan.loan_basis || 'purchase_price']}${request.flip && (loan.loan_basis || 'purchase_price') === 'purchase_price' && loan.rehab_financed_rate ? ' + financed share of the rehab budget' : ''}`)).join('; ');

// A loan whose term ends inside the projection is extended to its end at the
// same rate: the balance is repaid at the sale, not from the investor's
// pocket at maturity while the property is still held (the 2026-10-26
// review's second pass). The analysis says so when it happens.
const loanSchedule = (loan, principal, projectionMonths) => {
  const rate = (loan.annual_interest_rate || 0) / 12;
  const ioMonths = loan.interest_only_months || 0;
  const termMonths = Math.max(loan.term_months || 360, projectionMonths + 1);
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

// The note added when a loan's term ends before the hold does.
const extendedLoanWarning = (request) => {
  const hold = request.acquisition.hold_months;
  const terms = (request.debt || []).map((loan) => loan.term_months || 360).filter((term) => term < hold);
  if (!terms.length) return null;
  const term = Math.min(...terms);
  return `The ${hold}-month hold is longer than the ${term}-month loan term, so the loan is modeled as extended to the end of the hold at the same rate. Confirm the extension terms and fee with the lender, and add the fee to the costs.`;
};

const netPresentValue = (cashFlows, annualRate) => {
  const monthlyRate = (1 + annualRate) ** (1 / 12) - 1;
  return cashFlows.reduce((total, value, month) => total + value / ((1 + monthlyRate) ** month), 0);
};

const annualizedIrr = (cashFlows) => {
  if (!cashFlows.some((value) => value < 0) || !cashFlows.some((value) => value > 0)) return null;
  // Sum of value / (1 + rate)^month, worked from the last month back so each
  // step is one division. A simulation solves this thousands of times.
  const lastMonth = cashFlows.length - 1;
  const monthlyNpv = (rate) => {
    const growth = 1 + rate;
    let total = cashFlows[lastMonth];
    for (let month = lastMonth - 1; month >= 0; month -= 1) total = cashFlows[month] + total / growth;
    return total;
  };
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
    // Lenders commonly size on income after the reserves and TI they require,
    // so both coverages are reported (item 4 of the 2026-10-26 review).
    dscr_after_reserves: metric(ratio(yearOneNoi - yearOneCapital, yearOneDebtService), 'ratio', '(year-one NOI - replacement reserves - TI, leasing and capital costs) / year-one debt service', { noi: yearOneNoi, reserves_and_capital: yearOneCapital, debt_service: yearOneDebtService }, yearOneDebtService ? null : 'DSCR is undefined because the deal has no debt service.'),
    debt_yield: metric(ratio(yearOneNoi, totalDebt), 'decimal_rate', 'year-one NOI / total initial debt', { noi: yearOneNoi, total_debt: totalDebt }, totalDebt ? null : 'Debt yield is undefined because the deal has no debt.'),
    break_even_occupancy: metric(breakEven, 'decimal_rate', 'required rent collection / gross scheduled rent', { required_egi: requiredEgi, gross_scheduled_rent: grossRent }, grossRent ? null : 'Break-even occupancy is undefined because scheduled rent is zero.'),
    sale_price: metric(salePrice, request.property.currency, 'explicit terminal value or terminal NOI / exit cap rate', { terminal_noi: terminalNoi, exit_cap_rate: exitCap }),
  });
  const warnings = ['Calculated securely in this browser; no live analysis service was required.'];
  if (operating.gross_scheduled_rent === 0 && operating.other_income === 0) warnings.push('No operating income was entered, so year-one NOI is $0 before any expenses.');
  if (salePrice === 0) warnings.push('No terminal value can be calculated: enter an expected sale price or a positive exit cap rate with positive terminal NOI. The model therefore assumes $0 disposition proceeds.');
  if (metrics.irr.value == null) warnings.push('IRR is mathematically undefined because the modeled cash flows contain no positive distribution.');
  // Same sentence as the analysis service, so both paths say it.
  if (hold < 12) warnings.push('Year-one operating metrics are annualized from a holding period shorter than 12 months.');
  const extended = extendedLoanWarning(request);
  if (extended) warnings.push(extended);
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
    loan_amount: metric(totalDebt, request.property.currency, loanSizingFormula(request), {
      total_debt: totalDebt,
      basis_amount: (request.debt || []).filter((loan) => !loan.principal).reduce((sum, loan) => sum + loanBasisAmount(request, loan), 0),
      financed_rehab: (request.debt || []).filter((loan) => !loan.principal && (loan.loan_basis || 'purchase_price') === 'purchase_price').reduce((sum, loan) => sum + flip.rehab_cost * (loan.rehab_financed_rate || 0), 0),
    }),
  });
  const warnings = ['Calculated securely in this browser; no live analysis service was required.', 'After-repair value, construction budget, and timeline are user assumptions and require independent verification.'];
  if (salePrice === 0) warnings.push('No after-repair value was entered, so the model assumes $0 disposition proceeds.');
  const extended = extendedLoanWarning(request);
  if (extended) warnings.push(extended);
  return { analysis_id: `browser-${Date.now()}`, schema_version: '1.0', formula_version: FORMULA_VERSION, strategy: 'flip', computed_at: new Date().toISOString(), metrics, cash_flows: cashFlows, calculation_mode: 'browser', assumptions: { timing: 'Holding and debt costs occur monthly; sale occurs after the final month.' }, warnings };
};

// The timetable of a land development: the acquisition at closing, the budget
// spent evenly over the development months, the sales taken evenly over the
// absorption months at the end of the hold (item 3 of the 2026-10-26 review:
// the two schedule boxes did nothing). Both are kept inside the hold; a zero
// absorption means one sale in the final month.
export const landTimetable = (land, holdMonths) => ({
  development: Math.max(1, Math.min(land.development_months || 1, holdMonths)),
  absorption: Math.max(1, Math.min(land.absorption_months || 0, holdMonths)),
});

// The cash flows of a land development at a given price, with the facility's
// amounts given. Called once for the deal and again by the residual solver
// at other prices. It never throws; the caller checks the equity.
const landFigures = (request, purchasePrice, principals) => {
  const { acquisition, land } = request;
  const hold = acquisition.hold_months;
  const { development, absorption } = landTimetable(land, hold);
  const acquisitionCost = purchasePrice + acquisition.closing_costs + acquisition.due_diligence_costs + acquisition.initial_capex;
  const contingency = (land.site_work_cost + land.hard_construction_cost) * land.contingency_rate;
  const developmentCosts = land.site_work_cost + land.hard_construction_cost + land.soft_costs + land.permits_impact_fees + land.environmental_remediation + land.developer_fee + contingency;
  const totalProjectCost = acquisitionCost + developmentCosts;
  // The share of the whole cost spent by the end of each month, from closing.
  const spent = [];
  for (let month = 0; month <= hold; month += 1) {
    spent.push(totalProjectCost > 0 ? (acquisitionCost + developmentCosts * Math.min(month, development) / development) / totalProjectCost : 1);
  }
  const totalDebt = principals.reduce((sum, value) => sum + value, 0);
  const originationFees = principals.reduce((sum, principal, index) => sum + principal * (request.debt[index].origination_fee_rate || 0), 0);
  const monthlyCarrying = land.annual_carrying_costs / 12;
  const derivedTerminalValue = land.stabilized_noi > 0 && land.stabilized_exit_cap_rate > 0 ? land.stabilized_noi / land.stabilized_exit_cap_rate : 0;
  const terminalValue = Math.max(0, land.expected_terminal_value || derivedTerminalValue);
  const sellingCosts = terminalValue * request.exit.selling_cost_rate;
  const monthlyProceeds = (terminalValue - sellingCosts) / absorption;
  // The facility is drawn as the money is spent, so interest runs on the drawn
  // balance, not on the whole commitment from day one. A draw lands at the end
  // of its month and bears interest from the next. Sale proceeds pay the
  // facility down first, as a lender's release terms do; what is left at the
  // end of the hold is repaid then. The amortizing payment, where there is
  // one, is set on the whole commitment, as the lender writes it.
  const loans = (request.debt || []).map((loan, index) => {
    const rate = (loan.annual_interest_rate || 0) / 12;
    const ioMonths = loan.interest_only_months || 0;
    return { rate, ioMonths, principal: principals[index], balance: principals[index] * spent[0], payment: periodicPayment(principals[index], rate, Math.max((loan.amortization_years || 30) * 12 - ioMonths, 1)) };
  });
  const cashFlows = [{ month: 0, operating_cash_flow: 0, debt_service: 0, capital_costs: acquisitionCost + originationFees, sale_proceeds: 0, loan_payoff: 0, net_cash_flow: -(acquisitionCost + originationFees - totalDebt * spent[0]) }];
  let totalInterest = 0;
  for (let month = 1; month <= hold; month += 1) {
    const delta = spent[month] - spent[month - 1];
    const spend = totalProjectCost * delta;
    const draw = totalDebt * delta;
    const proceeds = month > hold - absorption ? monthlyProceeds : 0;
    let debtService = 0; let payoff = 0; let available = proceeds;
    loans.forEach((loan) => {
      const interest = loan.balance * loan.rate;
      const scheduledPrincipal = month <= loan.ioMonths ? 0 : Math.min(loan.balance, Math.max(loan.payment - interest, 0));
      loan.balance = loan.balance - scheduledPrincipal + loan.principal * delta;
      const release = Math.min(loan.balance, available);
      loan.balance -= release; available -= release;
      const atEnd = month === hold ? loan.balance : 0;
      if (atEnd) loan.balance = 0;
      totalInterest += interest;
      debtService += interest + scheduledPrincipal;
      payoff += release + atEnd;
    });
    cashFlows.push({ month, operating_cash_flow: 0, debt_service: clean(debtService), capital_costs: clean(spend + monthlyCarrying), sale_proceeds: clean(proceeds), loan_payoff: clean(payoff), net_cash_flow: clean(-(spend - draw) - monthlyCarrying - debtService + proceeds - payoff) });
  }
  const values = cashFlows.map((row) => row.net_cash_flow);
  const profit = values.reduce((sum, value) => sum + value, 0);
  const equityContributions = Math.abs(values.reduce((sum, value) => sum + Math.min(value, 0), 0));
  const totalCarrying = monthlyCarrying * hold;
  return {
    cashFlows, profit, equityContributions, totalInterest, totalCarrying, originationFees, totalDebt,
    totalProjectCost, acquisitionCost, developmentCosts, contingency, terminalValue, sellingCosts,
    economicCost: totalProjectCost + originationFees + totalInterest + totalCarrying, development, absorption,
  };
};

// The land price at which the development profit is exactly `target`, found by
// the secant method on the deal's own cash flows. The profit is linear in the
// price on a normal schedule, so the first step lands on the answer and the
// second confirms it; a clamp that binds (a balloon, a payment larger than the
// balance) takes a few more. Mirrored in the analysis service.
export const solveLandResidual = (profitAt, price, target) => {
  const f = (candidate) => profitAt(candidate) - target;
  let a = price; let fa = f(a);
  let b = price * 1.1 + 10000; let fb = f(b);
  for (let iteration = 0; iteration < 12; iteration += 1) {
    if (fb === fa || !Number.isFinite(fa) || !Number.isFinite(fb)) break;
    const next = b - fb * (b - a) / (fb - fa);
    if (!Number.isFinite(next)) break;
    a = b; fa = fb; b = next; fb = f(b);
    if (Math.abs(fb) < 1e-6) break;
  }
  return Number.isFinite(fb) ? b : null;
};

// A land hold shorter than development plus absorption cannot be modeled: a
// three-month hold on a twelve-month build read as a Go at a seven-figure
// IRR (the 2026-10-26 review's second pass). It is refused, not compressed.
export const landHoldTooShort = (land, holdMonths) => {
  const schedule = (land.development_months || 1) + (land.absorption_months || 0);
  return schedule > holdMonths
    ? `The ${holdMonths}-month hold is shorter than the development schedule plus the absorption (${land.development_months || 1} + ${land.absorption_months || 0} months). Lengthen the hold or shorten the schedule.`
    : null;
};

const analyzeLand = (request, { residual = true } = {}) => {
  const { acquisition, land } = request;
  const tooShort = landHoldTooShort(land, acquisition.hold_months);
  if (tooShort) throw new Error(tooShort);
  const principals = (request.debt || []).map((loan) => loanPrincipal(request, loan));
  const base = landFigures(request, acquisition.purchase_price, principals);
  const { totalProjectCost, originationFees, totalDebt, terminalValue } = base;
  if (totalProjectCost + originationFees - totalDebt <= 0) throw new Error('Construction financing must leave a positive equity contribution.');
  const breakEvenTerminalValue = request.exit.selling_cost_rate < 1 ? base.economicCost / (1 - request.exit.selling_cost_rate) : null;
  const nonLandCosts = totalProjectCost - acquisition.purchase_price;
  const facilityShare = totalProjectCost > 0 ? totalDebt / totalProjectCost : 0;
  // The land price at which development profit is exactly the target margin on
  // gross terminal value, which is how development margin is measured below.
  // Other costs stay as entered, the facility keeps its modeled share of
  // project cost (so fees and interest move with the price) and the timetable
  // is the same. Running the deal again at this price returns the target margin.
  const residualLandValue = residual ? solveLandResidual((price) => {
    const scale = totalProjectCost > 0 ? (totalProjectCost - acquisition.purchase_price + price) / totalProjectCost : 1;
    return landFigures(request, price, principals.map((principal) => principal * scale)).profit;
  }, acquisition.purchase_price, terminalValue * land.target_profit_margin) : null;
  const metrics = commonMetrics(request, base.cashFlows, totalDebt, totalProjectCost);
  Object.assign(metrics, {
    development_profit: metric(base.profit, request.property.currency, 'net disposition proceeds - equity contributions - carrying and financing costs', { terminal_value: terminalValue, selling_costs: base.sellingCosts, economic_cost: base.economicCost }),
    development_roi: metric(ratio(base.profit, base.equityContributions), 'decimal_rate', 'development profit / total equity contributions', { profit: base.profit, equity_contributions: base.equityContributions }),
    development_margin: metric(ratio(base.profit, terminalValue), 'decimal_rate', 'development profit / gross terminal value', { profit: base.profit, terminal_value: terminalValue }, terminalValue ? null : 'Development margin is undefined without a terminal value.'),
    total_development_cost: metric(totalProjectCost, request.property.currency, 'land acquisition + transaction + site + hard + soft + entitlement + environmental + developer fee + contingency', { acquisition_cost: base.acquisitionCost, development_costs: base.developmentCosts, contingency: base.contingency }),
    break_even_terminal_value: metric(breakEvenTerminalValue, request.property.currency, 'total economic cost / (1 - selling cost rate)', { economic_cost: base.economicCost, selling_cost_rate: request.exit.selling_cost_rate }),
    cost_per_acre: metric(ratio(totalProjectCost, land.site_acres), `${request.property.currency}/acre`, 'total development cost / site acres', { total_project_cost: totalProjectCost, site_acres: land.site_acres }),
    cost_per_unit: metric(ratio(totalProjectCost, land.planned_units), `${request.property.currency}/unit`, 'total development cost / planned units', { total_project_cost: totalProjectCost, planned_units: land.planned_units }),
    cost_per_buildable_sf: metric(ratio(totalProjectCost, land.buildable_square_feet), `${request.property.currency}/sf`, 'total development cost / buildable square feet', { total_project_cost: totalProjectCost, buildable_square_feet: land.buildable_square_feet }),
  });
  if (residual) {
    metrics.residual_land_value = metric(residualLandValue, request.property.currency, 'land price at which development profit equals the target margin on gross terminal value, with other costs as entered, the facility at its modeled share of project cost and the same timetable', { terminal_value: terminalValue, target_profit_margin: land.target_profit_margin, non_land_costs: nonLandCosts, carrying_costs: base.totalCarrying, facility_share_of_cost: facilityShare });
  }

  const warnings = ['Calculated securely in this browser; no live analysis service was required.', 'Land-development results depend on zoning, entitlement, utility, environmental, geotechnical, civil, market, and construction assumptions that require professional verification.'];
  if (!terminalValue) warnings.push('No terminal value can be calculated. Enter an expected gross exit value or stabilized NOI with a capitalization rate.');
  const schedule = land.development_months + (land.absorption_months || 0);
  if (schedule < acquisition.hold_months) warnings.push(`The hold is ${acquisition.hold_months - schedule} months longer than development plus absorption; carrying costs and interest on the drawn facility run for those months too.`);
  const extended = extendedLoanWarning(request);
  if (extended) warnings.push(extended);
  if (land.entitlement_status === 'unentitled' || land.entitlement_status === 'rezoning_required') warnings.push('The project carries material entitlement risk; probability, timing, and denial costs are not independently estimated.');
  if (land.utility_status !== 'available') warnings.push('Water, sewer, power, stormwater, and other utility capacity are not confirmed at the site; extensions and off-site upgrades may materially change cost and timing.');
  if (land.access_status !== 'legal_confirmed') warnings.push('Legal and physical access is not confirmed; verify frontage, curb cuts, easements, and emergency access.');
  if (land.environmental_status !== 'clear') warnings.push('Environmental diligence is incomplete or indicates a recognized condition; complete Phase I/II review and quantify remediation.');
  if (land.geotechnical_status !== 'complete_suitable') warnings.push('Geotechnical suitability is not confirmed; soils, rock, groundwater, slope, and foundation conditions may affect feasibility.');
  const floodWarning = floodZoneWarning(land.flood_zone);
  if (floodWarning) warnings.push(floodWarning);
  if ((land.wetlands_acres || 0) > 0) warnings.push('Wetlands were entered; verify delineation, buffers, mitigation, permitting, and the resulting net buildable area.');
  if (residual && residualLandValue !== null && residualLandValue < acquisition.purchase_price) warnings.push('The modeled residual land value is below the proposed purchase price, so the deal misses the selected target margin at this price.');
  if (land.planned_units < 1 && land.buildable_square_feet < 1) warnings.push('Enter planned units or buildable square feet to evaluate density and unit economics.');

  return { analysis_id: `browser-${Date.now()}`, schema_version: '1.0', formula_version: FORMULA_VERSION, strategy: 'land', computed_at: new Date().toISOString(), metrics, cash_flows: base.cashFlows, calculation_mode: 'browser', assumptions: { cost_timing: 'Acquisition costs fall at closing; the development budget is spent evenly over the development schedule; the facility is drawn as the money is spent, bears interest on the drawn balance and is repaid from sale proceeds first and otherwise at the end of the hold; sales are taken evenly over the absorption months at the end of the hold; carrying costs run monthly for the whole hold. Contingency applies to site work and hard construction only.', terminal_value: 'Uses explicit exit value first, otherwise stabilized NOI divided by exit cap rate.', taxes: 'Income taxes, depreciation, tax credits, and entity-level tax effects are not modeled.' }, warnings };
};

// `residual: false` leaves out the land residual, which costs two more passes
// over the cash flows; the simulation, which does not read it, says so.
export const analyzeDealLocally = (request, { residual = true } = {}) => {
  if (!(request.acquisition.purchase_price > 0)) throw new Error('Purchase price must be greater than zero.');
  if (request.strategy === 'land') return analyzeLand(request, { residual });
  const schedules = (request.debt || []).map((loan) => loanSchedule(loan, loanPrincipal(request, loan), request.acquisition.hold_months));
  const totalDebt = schedules.reduce((sum, schedule) => sum + schedule.principal, 0);
  const originationFees = schedules.reduce((sum, schedule, index) => sum + schedule.principal * (request.debt[index].origination_fee_rate || 0), 0);
  if (request.strategy === 'rental') return analyzeRental(request, schedules, totalDebt, originationFees);
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
  if (!valid.length) return { mean: null, minimum: null, p10: null, p25: null, p50: null, p75: null, p90: null, maximum: null, probability_above_zero: 0, probability_below_one: 0, sample_size: 0 };
  return { mean: valid.reduce((sum, value) => sum + value, 0) / valid.length, minimum: valid[0], p10: percentile(valid, .1), p25: percentile(valid, .25), p50: percentile(valid, .5), p75: percentile(valid, .75), p90: percentile(valid, .9), maximum: valid[valid.length - 1], probability_above_zero: valid.filter((value) => value > 0).length / valid.length, probability_below_one: valid.filter((value) => value < 1).length / valid.length, sample_size: valid.length };
};

// A losing iteration can have no solvable IRR: nothing came back, or the sale ended
// under water after some income. It is one of the worst outcomes, not a missing
// one, so Monte Carlo scores it with the annual return implied by cash returned
// over cash invested across the hold. Nothing back gives -100%. An unsolvable IRR
// on an iteration that made money stays out, because its sign is not certain.
export const lossEquivalentReturn = (equityMultiple, holdMonths) => (
  Number.isFinite(equityMultiple) && equityMultiple >= 0 && equityMultiple < 1 && holdMonths > 0
    ? equityMultiple ** (12 / holdMonths) - 1
    : null
);
const lossEquivalentIrr = (analysis) => (
  Number.isFinite(analysis.metrics?.irr?.value) || !Array.isArray(analysis.cash_flows)
    ? null
    : lossEquivalentReturn(analysis.metrics?.equity_multiple?.value, analysis.cash_flows.length - 1)
);

// The most iterations per case the browser runs. It matches the largest choice on
// the form. Simulation runs in steps (runMonteCarloInBrowser), so the page stays
// responsive however many are chosen.
export const BROWSER_MONTE_CARLO_ITERATION_CAP = 10000;

// Same wording as the API so both paths disclose the same limits.
export const MONTE_CARLO_STANDARD_WARNINGS = [
  'Distributions are user assumptions, not forecasts; correlations and fat-tail events are not inferred.',
  'Review percentile outcomes alongside the deterministic downside case and source evidence.',
];

// Copies only the parts a draw changes; every value is a number or a string.
const copyDeal = (deal) => ({
  ...deal,
  acquisition: { ...deal.acquisition },
  operating: deal.operating ? { ...deal.operating } : deal.operating,
  flip: deal.flip ? { ...deal.flip } : deal.flip,
  land: deal.land ? { ...deal.land } : deal.land,
  exit: { ...deal.exit },
  debt: (deal.debt || []).map((loan) => ({ ...loan })),
});

const LAND_COST_FIELDS = ['site_work_cost', 'hard_construction_cost', 'soft_costs', 'permits_impact_fees', 'environmental_remediation', 'developer_fee'];

// One case's simulation, advanced in steps. Each case keeps its own random
// stream, so its figures are the same whether it runs in one go or in steps
// with other cases taking turns in between.
// A lender sizes the loan once, at origination, on the underwritten figures.
// A draw that lowers the after-repair value or raises the rehab must not
// resize it, so a flip's loans are fixed at their base amount before any
// iteration runs. Other strategies' loans are left as sent.
// A pinned loan never exceeds the project cost it funds: when a case's cost
// falls below the base loan (a stressed case that spends no contingency, say),
// the lender funds the cost and no more. The marker never leaves the browser.
export const pinLoans = (deal) => {
  if (!deal.flip || !(deal.debt || []).some((loan) => !loan.principal)) return deal;
  return { ...deal, debt: deal.debt.map((loan) => (loan.principal ? loan : { ...loan, principal: loanPrincipal(deal, loan), loan_to_value: undefined, pinned: true })) };
};
export const capPinnedLoans = (deal) => {
  if (!(deal.debt || []).some((loan) => loan.pinned)) return deal;
  const cost = totalProjectCost(deal);
  return { ...deal, debt: deal.debt.map((loan) => (loan.pinned && loan.principal > cost ? { ...loan, principal: cost } : loan)) };
};

const createScenarioRun = (baseDeal, scenario) => {
  const deal = pinLoans(baseDeal);
  const iterations = Math.min(scenario.iterations, BROWSER_MONTE_CARLO_ITERATION_CAP);
  const random = seededRandom(scenario.seed);
  const drivers = Object.entries(scenario.drivers);
  const values = {};
  let attempted = 0; let lossesWithoutIrr = 0; let failures = 0; let firstFailure = null;

  const step = (count) => {
    const end = Math.min(iterations, attempted + count);
    for (; attempted < end; attempted += 1) {
      const shocked = copyDeal(deal);
      drivers.forEach(([driver, distribution]) => {
        const draw = triangular(random, distribution);
        if (driver === 'rent_change') shocked.operating.gross_scheduled_rent *= 1 + draw;
        if (driver === 'vacancy_rate') shocked.operating.vacancy_rate = draw;
        if (driver === 'operating_expense_change') shocked.operating.operating_expenses *= 1 + draw;
        if (driver === 'exit_cap_rate') shocked.exit.exit_cap_rate = draw;
        if (driver === 'interest_rate') shocked.debt.forEach((loan) => { loan.annual_interest_rate = draw; });
        // Months, rounded; the hold stays within the model's range.
        if (driver === 'hold_months_change') shocked.acquisition.hold_months = Math.max(1, Math.min(600, Math.round(shocked.acquisition.hold_months + draw)));
        if (driver === 'after_repair_value_change') shocked.flip.after_repair_value *= 1 + draw;
        if (driver === 'rehab_cost_change') {
          // The draw is the overrun that happened, and the contingency is the
          // reserve held for it, so the draw replaces the reserve instead of
          // being added on top of it: a 35% overrun with a 15% contingency costs
          // 35% over budget, not 1.35 x 1.15 = 55%. A draw equal to the
          // contingency rate reproduces the base case, which treats the whole
          // reserve as spent; a smaller draw means it was not all needed.
          shocked.flip.rehab_cost *= 1 + draw;
          shocked.flip.rehab_contingency_rate = 0;
        }
        if (driver === 'terminal_value_change') {
          if (shocked.land.expected_terminal_value > 0) shocked.land.expected_terminal_value *= 1 + draw;
          else shocked.land.stabilized_noi *= 1 + draw;
        }
        if (driver === 'development_cost_change') {
          // The draw is the cost change that happened, and the contingency is
          // the reserve held for it on site work and hard construction, so the
          // draw replaces the reserve instead of being added on top of it: a
          // 30% draw with a 10% contingency costs 30% over budget on those two
          // fields, not 1.3 x 1.1 = 43%. A draw equal to the contingency rate
          // reproduces the base case, which treats the whole reserve as spent;
          // a smaller draw means it was not all needed. Soft costs, permits,
          // remediation and the developer fee carry no contingency, so the draw
          // is their whole change.
          LAND_COST_FIELDS.forEach((key) => { shocked.land[key] *= 1 + draw; });
          shocked.land.contingency_rate = 0;
        }
      });
      let analysis;
      try { analysis = analyzeDealLocally(capPinnedLoans(shocked), { residual: false }); } catch (error) { failures += 1; if (!firstFailure) firstFailure = error; continue; }
      const lossIrr = lossEquivalentIrr(analysis);
      Object.entries(analysis.metrics).forEach(([key, item]) => {
        if (!values[key]) values[key] = [];
        if (Number.isFinite(item.value)) values[key].push(item.value);
        else if (key === 'irr' && lossIrr !== null) { values[key].push(lossIrr); lossesWithoutIrr += 1; }
      });
    }
  };

  const result = () => {
    const completed = attempted - failures;
    if (completed === 0) throw new Error(`Monte Carlo scenario '${scenario.name}' produced no valid iterations${firstFailure?.message ? `: ${firstFailure.message}` : '.'}`);
    const warnings = [...MONTE_CARLO_STANDARD_WARNINGS];
    if (scenario.iterations > iterations) warnings.push(`Browser simulation capped at ${BROWSER_MONTE_CARLO_ITERATION_CAP.toLocaleString('en-US')} iterations per case for responsiveness; ${scenario.iterations.toLocaleString('en-US')} were requested.`);
    if (failures) warnings.push(`${failures} iterations were excluded because sampled inputs produced invalid economics.`);
    return { name: scenario.name, iterations_requested: scenario.iterations, iterations_completed: completed, failed_iterations: failures, seed: scenario.seed, summaries: Object.fromEntries(Object.entries(values).map(([key, items]) => [key, { ...summarize(items), loss_without_irr_count: key === 'irr' ? lossesWithoutIrr : 0 }])), warnings };
  };

  return { step, result, total: iterations, done: () => attempted, remaining: () => iterations - attempted };
};

export const runMonteCarloLocally = ({ deal, scenarios }) => ({
  formula_version: FORMULA_VERSION,
  scenarios: scenarios.map((scenario) => {
    const run = createScenarioRun(deal, scenario);
    run.step(run.total);
    return run.result();
  }),
});

// Hands control back to the browser between blocks so it can redraw and take
// input. It waits on a message rather than a timer: a browser slows the timers
// of a tab that is not in view to one a second and later to one a minute, which
// stretched a two-second simulation past an hour when the visitor looked at
// another tab. Messages are not slowed. Where the browser has no message
// channel, a timer is used.
export const nextTask = () => new Promise((resolve) => {
  if (typeof MessageChannel !== 'function') { setTimeout(resolve, 0); return; }
  const channel = new MessageChannel();
  channel.port1.onmessage = () => { channel.port1.close(); resolve(); };
  channel.port2.postMessage(null);
});

// The same simulation as runMonteCarloLocally, run a block at a time with the
// cases taking turns, so the page can redraw and report progress in between.
// `onProgress(done, total)` is called after every round. If `shouldStop()`
// returns true the run is abandoned and the promise resolves to null: the
// inputs changed and the figures would no longer describe them.
export const runMonteCarloInBrowser = async ({ deal, scenarios }, { onProgress, shouldStop, blockSize = 125, pause = nextTask } = {}) => {
  const runs = scenarios.map((scenario) => createScenarioRun(deal, scenario));
  const total = runs.reduce((sum, run) => sum + run.total, 0);
  const done = () => runs.reduce((sum, run) => sum + run.done(), 0);
  if (onProgress) onProgress(0, total);
  while (runs.some((run) => run.remaining() > 0)) {
    runs.forEach((run) => run.step(blockSize));
    if (onProgress) onProgress(done(), total);
    await pause();
    if (shouldStop && shouldStop()) return null;
  }
  return { formula_version: FORMULA_VERSION, scenarios: runs.map((run) => run.result()) };
};
