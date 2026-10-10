import fs from 'fs';
import path from 'path';
import { analyzeDealLocally } from './dealAnalysis';
import { annualTotals, buildDealWorkbook, irrGuess } from './dealWorkbook';
import { buildDealRequest } from './dealRequest';

const landForm = {
  address: '11085 State Bridge Rd, Johns Creek, GA 30022', strategy: 'land', propertyType: 'land',
  market: 'Johns Creek, GA', units: '3', rentableSquareFeet: '15000', purchasePrice: '999999',
  closingCosts: '0', dueDiligenceCosts: '0', initialCapex: '0', holdMonths: '24', ltv: '0',
  sellingCosts: '5', discountRate: '10', developmentType: 'single_family_subdivision',
  dispositionStrategy: 'build_and_sell', siteAcres: '2.5', parcelCount: '1', currentZoning: 'R-4A',
  proposedZoning: 'R-4A', entitlementStatus: 'fully_entitled', utilityStatus: 'available',
  accessStatus: 'legal_confirmed', environmentalStatus: 'clear', geotechnicalStatus: 'complete_suitable',
  floodZone: 'X', wetlandsAcres: '0', developmentMonths: '18', absorptionMonths: '6',
  siteWorkCost: '300000', hardConstructionCost: '1500000', softCosts: '200000',
  permitsImpactFees: '100000', environmentalRemediation: '0', developerFee: '100000',
  landContingency: '10', annualCarryingCosts: '30000', expectedTerminalValue: '4500000',
  stabilizedNoi: '0', stabilizedExitCap: '0', targetProfitMargin: '20',
};

test('deal-specific XLSX contains the submitted land assumptions and reconciled results', () => {
  const landDeal = buildDealRequest(landForm);
  const result = analyzeDealLocally(landDeal);
  const bytes = buildDealWorkbook({ form: landForm, request: landDeal, result });
  expect(bytes[0]).toBe(0x50); expect(bytes[1]).toBe(0x4B);
  let raw = '';
  for (let offset = 0; offset < bytes.length; offset += 16000) raw += String.fromCharCode(...bytes.slice(offset, offset + 16000));
  expect(raw).toContain('11085 State Bridge Rd');
  expect(raw).toContain('Development profit');
  expect(raw).toContain(String(result.metrics.development_profit.value));
  expect(raw).toContain('Monthly Levered Cash Flow');
  const outputDir = path.resolve(__dirname, '../../../outputs/e2e_audit');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'DiamondEcho_Johns_Creek_E2E.xlsx'), bytes);
});

// --- What a spreadsheet shows before it recalculates (DE-25) -------------------
// Found on the release candidate: the annual sheet stored 0 for every total
// and the status column stored 0 for "OK", so Excel's Protected View, phone
// previews and LibreOffice showed zeros; and the IRR formula, left to its
// default guess, did not reach the website's figure in LibreOffice.

const rentalForm = {
  strategy: 'rental', propertyType: 'multifamily', market: 'Atlanta, GA', units: '2', rentableSquareFeet: '2820',
  purchasePrice: '500000', closingCosts: '15000', dueDiligenceCosts: '0', initialCapex: '15000', holdMonths: '60',
  ltv: '75', interestRate: '7.25', amortizationYears: '30', interestOnlyMonths: '0', loanTermYears: '10', originationFee: '0',
  annualRent: '52800', otherIncome: '0', vacancy: '5', propertyTaxes: '6500', insurance: '4000', repairsMaintenance: '3009.6',
  utilities: '0', payrollAdmin: '1500', managementFee: '8', reserves: '2508', annualBelowNoiCosts: '0', incomeGrowth: '3',
  expenseGrowth: '3', exitCap: '6.5', explicitSalePrice: '', sellingCosts: '6', discountRate: '10',
};

const workbookText = (form, change = (result) => result) => {
  const request = buildDealRequest(form);
  const result = change(analyzeDealLocally(request));
  const bytes = buildDealWorkbook({ form, request, result });
  let raw = '';
  for (let offset = 0; offset < bytes.length; offset += 16000) raw += String.fromCharCode(...bytes.slice(offset, offset + 16000));
  return { raw, request, result };
};

// Every formula cell: its reference, type, formula and stored result.
const formulaCells = (raw) => [...raw.matchAll(/<c r="([A-Z]+\d+)"( t="str")?[^>]*><f>([^<]*)<\/f>(?:<v>([^<]*)<\/v>)?<\/c>/g)]
  .map(([, reference, text, formula, stored]) => ({ reference, text: Boolean(text), formula: formula.replaceAll('&apos;', "'").replaceAll('&quot;', '"').replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&'), stored }));

test.each([['rental', rentalForm], ['land', landForm]])('every formula in the %s workbook stores its real result', (_, form) => {
  const { raw, result } = workbookText(form);
  const cells = formulaCells(raw);
  expect(cells.length).toBeGreaterThan(10);
  cells.forEach((item) => expect(item.stored).toBeDefined());

  // Status formulas store the word, typed as text, never a number.
  const statuses = cells.filter((item) => item.formula.startsWith('IF('));
  expect(statuses).toHaveLength(5);
  statuses.forEach((item) => { expect(item.text).toBe(true); expect(['OK', 'REVIEW', 'FAIL']).toContain(item.stored); });
  expect(cells.filter((item) => !item.formula.startsWith('IF(')).every((item) => !item.text && Number.isFinite(Number(item.stored)))).toBe(true);

  // Annual totals: what the SUMIF over the monthly sheet adds up to.
  const annual = cells.filter((item) => item.formula.startsWith('SUMIF(') && /,A\d+,/.test(item.formula));
  const years = Math.ceil(result.cash_flows.length > 1 ? (result.cash_flows.length - 1) / 12 : 0);
  expect(annual).toHaveLength(years * 5);
  const equityByYear = annual.filter((item) => item.formula.includes('$H$') && !item.formula.includes('$F$')).map((item) => Number(item.stored));
  equityByYear.forEach((stored, index) => expect(stored).toBeCloseTo(annualTotals(result.cash_flows, index + 1).equity, 6));
  expect(equityByYear.some((value) => value !== 0)).toBe(true);
  const allNet = result.cash_flows.reduce((sum, flow) => sum + flow.net_cash_flow, 0);
  expect(equityByYear.reduce((sum, value) => sum + value, 0) + result.cash_flows[0].net_cash_flow).toBeCloseTo(allNet, 4);
});

test('annual totals use the signs the monthly sheet uses', () => {
  const flows = [
    { month: 0, operating_cash_flow: 0, debt_service: 0, capital_costs: 100, sale_proceeds: 0, loan_payoff: 0, net_cash_flow: -100 },
    { month: 1, operating_cash_flow: 10, debt_service: 4, capital_costs: 1, sale_proceeds: 0, loan_payoff: 0, net_cash_flow: 5 },
    { month: 12, operating_cash_flow: 10, debt_service: 4, capital_costs: 0, sale_proceeds: 200, loan_payoff: 60, net_cash_flow: 146 },
    { month: 13, operating_cash_flow: 7, debt_service: 0, capital_costs: 0, sale_proceeds: 0, loan_payoff: 0, net_cash_flow: 7 },
  ];
  expect(annualTotals(flows, 1)).toEqual({ operating: 20, debt: -8, capital: -1, saleLessPayoff: 140, equity: 151 });
  expect(annualTotals(flows, 2)).toEqual({ operating: 7, debt: 0, capital: 0, saleLessPayoff: 0, equity: 7 });
  // Month 0 is the purchase and belongs to no year.
  expect(annualTotals(flows, 0).equity).toBe(-100);
});

test('the IRR formula starts from the monthly rate the website found', () => {
  expect(irrGuess(0.10086487)).toBe(',0.00804');
  expect(irrGuess(-0.08978151)).toBe(',-0.007809');
  expect(irrGuess(0)).toBe(',0');
  expect(irrGuess(-1)).toBe('');
  expect(irrGuess(Number.NaN)).toBe('');
  const { raw, result } = workbookText(rentalForm);
  const irr = formulaCells(raw).find((item) => item.formula.includes('IRR('));
  expect(irr.formula).toMatch(/^\(1\+IRR\('Monthly Cash Flow'!\$H\$5:\$H\$65,0\.\d+\)\)\^12-1$/);
  expect(Number(irr.stored)).toBe(result.metrics.irr.value);
  const monthly = Number(irr.formula.match(/,(-?[\d.]+)\)\)/)[1]);
  expect((1 + monthly) ** 12 - 1).toBeCloseTo(result.metrics.irr.value, 4);
});

test('a status that fails is stored as failing, and so is the overall status', () => {
  // One cash-flow row short of the hold period.
  const { raw } = workbookText(rentalForm, (result) => ({ ...result, cash_flows: result.cash_flows.slice(0, -1) }));
  const cells = formulaCells(raw);
  expect(cells.find((item) => item.formula === 'B5-C5').stored).toBe('-1');
  const statuses = cells.filter((item) => item.formula.startsWith('IF(')).map((item) => item.stored);
  expect(statuses[0]).toBe('FAIL');
  expect(statuses[4]).toBe('FAIL');
});
