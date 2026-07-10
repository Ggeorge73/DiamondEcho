const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const xmlEscape = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');

const utf8 = (value) => {
  const encoded = unescape(encodeURIComponent(value));
  const bytes = new Uint8Array(encoded.length);
  for (let index = 0; index < encoded.length; index += 1) bytes[index] = encoded.charCodeAt(index);
  return bytes;
};

const concatBytes = (parts) => {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => { output.set(part, offset); offset += part.length; });
  return output;
};

const write16 = (view, offset, value) => view.setUint16(offset, value, true);
const write32 = (view, offset, value) => view.setUint32(offset, value >>> 0, true);
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xEDB88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
const crc32 = (bytes) => {
  let crc = 0xFFFFFFFF;
  bytes.forEach((byte) => { crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8); });
  return (crc ^ 0xFFFFFFFF) >>> 0;
};

const zipStore = (entries) => {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  entries.forEach(({ name, content }) => {
    const nameBytes = utf8(name);
    const data = typeof content === 'string' ? utf8(content) : content;
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034B50); write16(localView, 4, 20); write16(localView, 6, 0x0800);
    write16(localView, 8, 0); write16(localView, 10, 0); write16(localView, 12, 0);
    write32(localView, 14, crc); write32(localView, 18, data.length); write32(localView, 22, data.length);
    write16(localView, 26, nameBytes.length); write16(localView, 28, 0); local.set(nameBytes, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    write32(centralView, 0, 0x02014B50); write16(centralView, 4, 20); write16(centralView, 6, 20);
    write16(centralView, 8, 0x0800); write16(centralView, 10, 0); write16(centralView, 12, 0); write16(centralView, 14, 0);
    write32(centralView, 16, crc); write32(centralView, 20, data.length); write32(centralView, 24, data.length);
    write16(centralView, 28, nameBytes.length); write16(centralView, 30, 0); write16(centralView, 32, 0);
    write16(centralView, 34, 0); write16(centralView, 36, 0); write32(centralView, 38, 0); write32(centralView, 42, localOffset);
    central.set(nameBytes, 46); centralParts.push(central);
    localOffset += local.length + data.length;
  });
  const centralDirectory = concatBytes(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054B50); write16(endView, 4, 0); write16(endView, 6, 0);
  write16(endView, 8, entries.length); write16(endView, 10, entries.length);
  write32(endView, 12, centralDirectory.length); write32(endView, 16, localOffset); write16(endView, 20, 0);
  return concatBytes([...localParts, centralDirectory, end]);
};

const columnName = (index) => {
  let number = index + 1; let output = '';
  while (number > 0) { const remainder = (number - 1) % 26; output = String.fromCharCode(65 + remainder) + output; number = Math.floor((number - 1) / 26); }
  return output;
};

const cell = (value, style = 0, formula = null) => ({ value, style, formula });
const cellXml = (descriptor, rowIndex, columnIndex) => {
  if (!descriptor || descriptor.value == null) return '';
  const reference = `${columnName(columnIndex)}${rowIndex}`;
  const style = descriptor.style ? ` s="${descriptor.style}"` : '';
  if (descriptor.formula) return `<c r="${reference}"${style}><f>${xmlEscape(descriptor.formula)}</f><v>${Number.isFinite(descriptor.value) ? descriptor.value : 0}</v></c>`;
  if (typeof descriptor.value === 'number') return `<c r="${reference}"${style}><v>${descriptor.value}</v></c>`;
  return `<c r="${reference}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEscape(descriptor.value)}</t></is></c>`;
};

const worksheetXml = ({ rows, widths, merges = [], freezeRows = 0, autoFilter = null }) => {
  const rowXml = rows.map((row, rowOffset) => {
    const rowIndex = rowOffset + 1;
    const firstStyle = row.find(Boolean)?.style;
    const hasLongMethod = row.some((item) => item?.style === 15 && String(item.value || '').length > 80);
    const height = rowIndex === 1 ? 30 : rowIndex === 2 ? 23 : firstStyle === 2 ? 21 : firstStyle === 14 ? 32 : hasLongMethod ? 28 : null;
    return `<row r="${rowIndex}"${height ? ` ht="${height}" customHeight="1"` : ''}>${row.map((item, columnIndex) => cellXml(item, rowIndex, columnIndex)).join('')}</row>`;
  }).join('');
  const columns = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
  const pane = freezeRows ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freezeRows}" topLeftCell="A${freezeRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map((reference) => `<mergeCell ref="${reference}"/>`).join('')}</mergeCells>` : '';
  const filterXml = autoFilter ? `<autoFilter ref="${autoFilter}"/>` : '';
  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}<sheetFormatPr defaultRowHeight="15"/><cols>${columns}</cols><sheetData>${rowXml}</sheetData>${filterXml}${mergeXml}<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
};

const stylesXml = () => `${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="$#,##0;[Red]($#,##0);-"/><numFmt numFmtId="165" formatCode="0.0%;[Red](0.0%);-"/><numFmt numFmtId="166" formatCode="0.00x;[Red](0.00x);-"/><numFmt numFmtId="167" formatCode="$0.00;[Red]($0.00);-"/></numFmts>
<fonts count="5"><font><sz val="10"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="18"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Arial"/></font><font><color rgb="FF0000FF"/><sz val="10"/><name val="Arial"/></font><font><b/><color rgb="FF10281F"/><sz val="10"/><name val="Arial"/></font></fonts>
<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF10281F"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE9DFC4"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9EAD3"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD9D5CA"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="19">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="3" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="164" fontId="4" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/><xf numFmtId="165" fontId="4" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/><xf numFmtId="166" fontId="4" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/><xf numFmtId="0" fontId="4" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="164" fontId="3" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/><xf numFmtId="165" fontId="3" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/><xf numFmtId="0" fontId="3" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

const labelize = (key) => key.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const outputStyle = (unit) => unit === 'decimal_rate' ? 10 : unit === 'multiple' || unit === 'ratio' ? 11 : unit?.startsWith('USD') ? 9 : 3;
const inputStyle = (value, unit) => typeof value === 'number' && unit === 'USD' ? 16 : typeof value === 'number' && unit === '%' ? 17 : 4;

const metricOrder = {
  rental: ['irr', 'cash_on_cash', 'cap_rate', 'dscr', 'noi', 'npv', 'equity_multiple', 'break_even_occupancy', 'sale_price', 'ltv', 'ltc'],
  flip: ['flip_profit', 'flip_roi', 'irr', 'npv', 'equity_multiple', 'max_offer_70_rule', 'ltv', 'ltc'],
  land: ['development_profit', 'development_roi', 'irr', 'npv', 'development_margin', 'total_development_cost', 'residual_land_value', 'break_even_terminal_value', 'cost_per_acre', 'cost_per_unit', 'cost_per_buildable_sf', 'ltc'],
};

const metricLabels = {
  irr: 'Projected IRR', cash_on_cash: 'Cash-on-cash return', cap_rate: 'Going-in cap rate', dscr: 'Debt service coverage', noi: 'Year-one NOI', npv: 'Net present value', equity_multiple: 'Equity multiple', break_even_occupancy: 'Break-even occupancy', sale_price: 'Terminal sale value', ltv: 'Loan-to-value', ltc: 'Loan-to-cost', flip_profit: 'Projected profit', flip_roi: 'Flip ROI', max_offer_70_rule: '70% screening threshold', development_profit: 'Development profit', development_roi: 'Development ROI', development_margin: 'Development margin', total_development_cost: 'Total development cost', residual_land_value: 'Residual land value', break_even_terminal_value: 'Break-even terminal value', cost_per_acre: 'Cost per acre', cost_per_unit: 'Cost per planned unit', cost_per_buildable_sf: 'Cost per buildable square foot',
};

const inputRows = ({ form, request }) => {
  const rows = [[cell('Deal Inputs', 1), null, null, null, null], [cell('Blue-font cells are the exact assumptions submitted from Deal Analysis.', 2), null, null, null, null], [], [cell('PROPERTY & ACQUISITION', 2), null, null, null, null]];
  const rowMap = {};
  const add = (key, label, value, unit = '', note = '') => { rows.push([cell(label), cell(value, inputStyle(value, unit)), cell(unit), cell(note)]); rowMap[key] = rows.length; };
  add('address', 'Property address', form.address || 'Not entered'); add('strategy', 'Strategy', request.strategy);
  add('property_type', 'Asset type', request.property.property_type); add('market', 'Market', request.property.market || 'Not entered');
  add('units', request.strategy === 'land' ? 'Planned units / lots' : 'Units', request.property.unit_count, 'count');
  add('square_feet', request.strategy === 'land' ? 'Buildable square feet' : 'Rentable square feet', request.property.rentable_square_feet || 0, 'sf');
  add('purchase_price', 'Purchase price', request.acquisition.purchase_price, 'USD'); add('closing_costs', 'Closing costs', request.acquisition.closing_costs, 'USD');
  add('due_diligence', 'Due diligence costs', request.acquisition.due_diligence_costs, 'USD'); add('initial_capex', 'Initial capital work', request.acquisition.initial_capex, 'USD'); add('hold_months', 'Hold period', request.acquisition.hold_months, 'months');
  rows.push([], [cell('DEBT & DISCOUNTING', 2), null, null, null]);
  const loan = request.debt?.[0];
  add('loan_amount', 'Initial loan amount', loan ? (loan.principal || request.acquisition.purchase_price * (loan.loan_to_value || 0)) : 0, 'USD');
  add('interest_rate', 'Annual interest rate', loan?.annual_interest_rate || 0, '%'); add('amortization', 'Amortization', loan?.amortization_years || 0, 'years');
  add('interest_only', 'Interest-only period', loan?.interest_only_months || 0, 'months'); add('loan_term', 'Loan term', loan?.term_months || 0, 'months'); add('origination_fee', 'Origination fee', loan?.origination_fee_rate || 0, '%');
  add('selling_costs', 'Selling costs', request.exit.selling_cost_rate || 0, '%'); add('discount_rate', 'Annual discount rate', request.assumptions.annual_discount_rate || 0, '%');
  if (request.strategy === 'rental') {
    rows.push([], [cell('OPERATIONS & EXIT', 2), null, null, null]);
    const operating = request.operating;
    add('rent', 'Annual scheduled rent', operating.gross_scheduled_rent, 'USD'); add('other_income', 'Other annual income', operating.other_income, 'USD');
    add('vacancy', 'Vacancy rate', operating.vacancy_rate, '%'); add('operating_expenses', 'Operating expenses before management', operating.operating_expenses, 'USD');
    add('management_fee', 'Management fee', operating.management_fee_rate, '%'); add('reserves', 'Replacement reserves', operating.replacement_reserves, 'USD');
    add('below_noi', 'Annual below-NOI capital', operating.annual_below_noi_costs, 'USD'); add('income_growth', 'Annual income growth', operating.annual_income_growth_rate, '%');
    add('expense_growth', 'Annual expense growth', operating.annual_expense_growth_rate, '%'); add('exit_cap', 'Exit capitalization rate', request.exit.exit_cap_rate || 0, '%'); add('explicit_sale', 'Explicit terminal value', request.exit.explicit_sale_price || 0, 'USD');
  } else if (request.strategy === 'flip') {
    rows.push([], [cell('PROJECT & DISPOSITION', 2), null, null, null]);
    add('arv', 'After-repair value', request.flip.after_repair_value, 'USD'); add('rehab', 'Rehabilitation budget', request.flip.rehab_cost, 'USD'); add('rehab_contingency', 'Rehab contingency', request.flip.rehab_contingency_rate, '%'); add('monthly_holding', 'Monthly holding costs', request.flip.monthly_holding_costs, 'USD'); add('other_project', 'Other project costs', request.flip.other_project_costs, 'USD');
  } else {
    rows.push([], [cell('LAND DEVELOPMENT', 2), null, null, null]);
    const landUnits = {
      site_acres: 'acres', parcel_count: 'count', wetlands_acres: 'acres', planned_units: 'count',
      buildable_square_feet: 'sf', development_months: 'months', absorption_months: 'months',
      site_work_cost: 'USD', hard_construction_cost: 'USD', soft_costs: 'USD', permits_impact_fees: 'USD',
      environmental_remediation: 'USD', developer_fee: 'USD', contingency_rate: '%', annual_carrying_costs: 'USD',
      expected_terminal_value: 'USD', stabilized_noi: 'USD', stabilized_exit_cap_rate: '%', target_profit_margin: '%',
    };
    Object.entries(request.land).forEach(([key, value]) => add(`land_${key}`, labelize(key), value, landUnits[key] || ''));
  }
  return { rows, rowMap };
};

const buildWorkbookParts = ({ form, request, result }) => {
  const { rows: inputs, rowMap } = inputRows({ form, request });
  const cashStart = 5; const cashEnd = cashStart + result.cash_flows.length - 1;
  const cashRows = [[cell('Monthly Levered Cash Flow', 1), null, null, null, null, null, null, null], [cell(`Exact ${request.acquisition.hold_months}-month schedule used by the website calculation.`, 2), null, null, null, null, null, null, null], [], [cell('Month', 3), cell('Year', 3), cell('Operating Cash Flow', 3), cell('Debt Service', 3), cell('Capital Costs', 3), cell('Net Sale Proceeds', 3), cell('Loan Payoff', 3), cell('Net Cash Flow', 3)]];
  result.cash_flows.forEach((flow) => cashRows.push([cell(flow.month, 8), cell(flow.month === 0 ? 0 : Math.ceil(flow.month / 12), 8), cell(flow.operating_cash_flow, 5), cell(-Math.abs(flow.debt_service), 5), cell(-Math.abs(flow.capital_costs), 5), cell(flow.sale_proceeds, 5), cell(-Math.abs(flow.loan_payoff), 5), cell(flow.net_cash_flow, 5)]));

  const summaryRows = [[cell('DIAMOND ECHO — DEAL-SPECIFIC ANALYSIS', 1), null, null, null], [cell(`${form.address || 'Property not specified'} · ${request.strategy.toUpperCase()} · generated ${new Date().toISOString().slice(0, 10)}`, 2), null, null, null], [], [cell('Investment Committee Metric', 3), cell('Result', 3), cell('Unit', 3), cell('Method / Formula', 3)]];
  (metricOrder[request.strategy] || Object.keys(result.metrics)).forEach((key) => {
    const item = result.metrics[key]; if (!item) return;
    let formula = null;
    if (key === 'irr' && item.value != null) formula = `(1+IRR('Monthly Cash Flow'!$H$${cashStart}:$H$${cashEnd}))^12-1`;
    if (key === 'npv') formula = `NPV((1+'Inputs'!$B$${rowMap.discount_rate})^(1/12)-1,'Monthly Cash Flow'!$H$${cashStart + 1}:$H$${cashEnd})+'Monthly Cash Flow'!$H$${cashStart}`;
    if (key === 'equity_multiple' && item.value != null) formula = `SUMIF('Monthly Cash Flow'!$H$${cashStart}:$H$${cashEnd},\">0\",'Monthly Cash Flow'!$H$${cashStart}:$H$${cashEnd})/ABS(SUMIF('Monthly Cash Flow'!$H$${cashStart}:$H$${cashEnd},\"<0\",'Monthly Cash Flow'!$H$${cashStart}:$H$${cashEnd}))`;
    const displayUnit = item.unit === 'decimal_rate' ? '%' : item.unit === 'multiple' || item.unit === 'ratio' ? 'x' : item.unit;
    summaryRows.push([cell(metricLabels[key] || labelize(key)), item.value == null ? cell('Not defined', 3) : cell(item.value, outputStyle(item.unit), formula), cell(displayUnit), cell(item.formula, 15)]);
  });
  summaryRows.push([], [cell('MODEL INTERPRETATION', 2), null, null, null]);
  result.warnings.forEach((warning) => summaryRows.push([cell('Review', 14), cell(warning, 14), null, null]));

  const years = Math.ceil(request.acquisition.hold_months / 12);
  const annualRows = [[cell('Annual Cash Flow Summary', 1), null, null, null, null, null, null], [cell('Formula-linked roll-up of the monthly cash-flow schedule.', 2), null, null, null, null, null, null], [], [cell('Year', 3), cell('Operating Cash Flow', 3), cell('Debt Service', 3), cell('Capital Costs', 3), cell('Net Sale / Payoff', 3), cell('Equity Cash Flow', 3)]];
  for (let year = 1; year <= years; year += 1) {
    const row = annualRows.length + 1;
    annualRows.push([cell(year, 8), cell(0, 5, `SUMIF('Monthly Cash Flow'!$B$${cashStart}:$B$${cashEnd},A${row},'Monthly Cash Flow'!$C$${cashStart}:$C$${cashEnd})`), cell(0, 5, `SUMIF('Monthly Cash Flow'!$B$${cashStart}:$B$${cashEnd},A${row},'Monthly Cash Flow'!$D$${cashStart}:$D$${cashEnd})`), cell(0, 5, `SUMIF('Monthly Cash Flow'!$B$${cashStart}:$B$${cashEnd},A${row},'Monthly Cash Flow'!$E$${cashStart}:$E$${cashEnd})`), cell(0, 5, `SUMIF('Monthly Cash Flow'!$B$${cashStart}:$B$${cashEnd},A${row},'Monthly Cash Flow'!$F$${cashStart}:$F$${cashEnd})+SUMIF('Monthly Cash Flow'!$B$${cashStart}:$B$${cashEnd},A${row},'Monthly Cash Flow'!$G$${cashStart}:$G$${cashEnd})`), cell(0, 5, `SUMIF('Monthly Cash Flow'!$B$${cashStart}:$B$${cashEnd},A${row},'Monthly Cash Flow'!$H$${cashStart}:$H$${cashEnd})`)]);
  }

  const positiveDistributions = result.cash_flows.filter((flow) => flow.net_cash_flow > 0).length;
  const saleProceeds = result.cash_flows.reduce((sum, flow) => sum + flow.sale_proceeds, 0);
  const checks = [[cell('Checks & Warnings', 1), null, null, null, null, null], [cell('One assertion per row; REVIEW flags require judgment rather than representing a formula error.', 2), null, null, null, null, null], [], [cell('Check', 3), cell('Actual', 3), cell('Expected', 3), cell('Difference', 3), cell('Tolerance', 3), cell('Status', 3)], [cell('Cash-flow row count'), cell(result.cash_flows.length), cell(request.acquisition.hold_months + 1), cell(0, 8, 'B5-C5'), cell(0), cell('OK', 12, 'IF(ABS(D5)<=E5,"OK","FAIL")')], [cell('Initial equity is an outflow'), cell(result.cash_flows[0].net_cash_flow, 5), cell('Negative'), null, null, cell('OK', 12, 'IF(B6<0,"OK","FAIL")')], [cell('Positive distributions available for IRR'), cell(positiveDistributions), cell('At least 1'), null, null, cell(positiveDistributions ? 'OK' : 'REVIEW', positiveDistributions ? 12 : 14, 'IF(B7>=1,"OK","REVIEW")')], [cell('Terminal sale proceeds'), cell(saleProceeds, 5), cell('Greater than 0'), null, null, cell(saleProceeds > 0 ? 'OK' : 'REVIEW', saleProceeds > 0 ? 12 : 14, 'IF(B8>0,"OK","REVIEW")')], [cell('Overall model status'), null, null, null, null, cell('OK', 12, 'IF(COUNTIF(F5:F8,"FAIL")>0,"FAIL",IF(COUNTIF(F5:F8,"REVIEW")>0,"REVIEW","OK"))')], [], [cell('WARNINGS', 2), null, null, null, null, null]];
  result.warnings.forEach((warning) => checks.push([cell(warning, 14), null, null, null, null, null]));

  const cover = [[cell('DIAMOND ECHO', 1), null, null, null], [cell('Deal-Specific Institutional Real Estate Analysis', 2), null, null, null], [], [cell('Property', 3), cell(form.address || 'Not entered')], [cell('Strategy', 3), cell(request.strategy)], [cell('Formula version', 3), cell(result.formula_version)], [cell('Generated', 3), cell(new Date().toISOString())], [cell('Model status', 3), cell('Review the Checks & Warnings sheet before reliance.')], [], [cell('HOW TO USE', 2), null, null, null], [cell('1'), cell('This workbook contains the exact assumptions and cash flows submitted through the Deal Analysis page.')], [cell('2'), cell('Blue-font inputs document the submitted assumptions; calculation outputs reconcile to the website result.')], [cell('3'), cell('IRR is intentionally shown as undefined when cash flows do not include both an outflow and a positive distribution.')], [cell('4'), cell('This is an illustrative underwriting tool, not an appraisal, tax opinion, credit decision, or investment recommendation.')]];

  const interpretationRow = summaryRows.findIndex((row) => row[0]?.value === 'MODEL INTERPRETATION') + 1;
  const summaryMerges = ['A1:D1', 'A2:D2', `A${interpretationRow}:D${interpretationRow}`];
  for (let row = interpretationRow + 1; row <= summaryRows.length; row += 1) summaryMerges.push(`B${row}:D${row}`);
  const checksWarningRow = checks.findIndex((row) => row[0]?.value === 'WARNINGS') + 1;
  const checksMerges = ['A1:F1', 'A2:F2', `A${checksWarningRow}:F${checksWarningRow}`];
  for (let row = checksWarningRow + 1; row <= checks.length; row += 1) checksMerges.push(`A${row}:F${row}`);

  return [
    { name: 'Cover', rows: cover, widths: [24, 92, 14, 14], merges: ['A1:D1', 'A2:D2', 'A10:D10'] },
    { name: 'Executive Summary', rows: summaryRows, widths: [31, 22, 19, 72], merges: summaryMerges, freezeRows: 4 },
    { name: 'Inputs', rows: inputs, widths: [37, 32, 15, 65], merges: ['A1:D1', 'A2:D2'], freezeRows: 4 },
    { name: 'Monthly Cash Flow', rows: cashRows, widths: [10, 10, 21, 18, 18, 20, 18, 20], merges: ['A1:H1', 'A2:H2'], freezeRows: 4, autoFilter: `A4:H${cashEnd}` },
    { name: 'Annual Cash Flow', rows: annualRows, widths: [11, 23, 20, 20, 22, 22], merges: ['A1:F1', 'A2:F2'], freezeRows: 4 },
    { name: 'Checks & Warnings', rows: checks, widths: [55, 19, 19, 19, 14, 16], merges: checksMerges, freezeRows: 4 },
  ];
};

export const buildDealWorkbook = ({ form, request, result }) => {
  const sheets = buildWorkbookParts({ form, request, result });
  const contentTypes = `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const rootRels = `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const workbook = `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`;
  const workbookRels = `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const now = new Date().toISOString();
  const core = `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>DiamondEcho Deal-Specific Analysis</dc:title><dc:creator>DiamondEcho</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const app = `${XML_HEADER}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>DiamondEcho Deal Analysis</Application><AppVersion>1.1</AppVersion></Properties>`;
  const entries = [{ name: '[Content_Types].xml', content: contentTypes }, { name: '_rels/.rels', content: rootRels }, { name: 'docProps/core.xml', content: core }, { name: 'docProps/app.xml', content: app }, { name: 'xl/workbook.xml', content: workbook }, { name: 'xl/_rels/workbook.xml.rels', content: workbookRels }, { name: 'xl/styles.xml', content: stylesXml() }];
  sheets.forEach((sheet, index) => entries.push({ name: `xl/worksheets/sheet${index + 1}.xml`, content: worksheetXml(sheet) }));
  return zipStore(entries);
};

export const downloadDealWorkbook = ({ form, request, result }) => {
  const bytes = buildDealWorkbook({ form, request, result });
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const property = (form.address || request.property.market || 'Deal').split(',')[0].replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
  anchor.href = url; anchor.download = `DiamondEcho_${property || 'Deal'}_${request.strategy}_Analysis.xlsx`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
