import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  AlertCircle, ArrowRight, BarChart3, Building2, CheckCircle2, ChevronDown,
  CircleDollarSign, Database, Download, FileSpreadsheet, Home, Loader2,
  MapPin, RotateCcw, ShieldCheck, Sparkles, TrendingUp
} from 'lucide-react';
import { properties } from '../data/mockData';
import { analyzeDealLocally, runMonteCarloLocally } from '../lib/dealAnalysis';

const MARKET_OPTIONS = [
  'Atlanta, GA', 'Austin, TX', 'Boston, MA', 'Charlotte, NC', 'Chicago, IL',
  'Dallas, TX', 'Denver, CO', 'Houston, TX', 'Las Vegas, NV', 'Los Angeles, CA',
  'Miami, FL', 'Nashville, TN', 'New York, NY', 'Orlando, FL', 'Philadelphia, PA',
  'Phoenix, AZ', 'Raleigh, NC', 'San Antonio, TX', 'San Diego, CA',
  'San Francisco, CA', 'Seattle, WA', 'Tampa, FL', 'Washington, DC',
];

const LOCAL_ADDRESSES = properties.map((property) => ({
  id: `local-${property.id}`,
  label: `${property.address}, ${property.city}, ${property.state} ${property.zip}`,
  kind: 'address', provider: 'review', property,
}));

const initialForm = {
  address: '', strategy: 'rental', propertyType: 'multifamily', market: 'Austin, TX',
  units: '12', rentableSquareFeet: '18000', purchasePrice: '3000000',
  closingCosts: '75000', dueDiligenceCosts: '25000', initialCapex: '125000', holdMonths: '60',
  ltv: '65', interestRate: '6.75', amortizationYears: '30', interestOnlyMonths: '0',
  loanTermYears: '10', originationFee: '1', annualRent: '360000', otherIncome: '18000',
  vacancy: '5', propertyTaxes: '54000', insurance: '24000', repairsMaintenance: '18000',
  utilities: '12000', payrollAdmin: '18000', managementFee: '4', reserves: '30000',
  annualBelowNoiCosts: '10000', incomeGrowth: '3', expenseGrowth: '3', exitCap: '6.5',
  explicitSalePrice: '',
  arv: '4200000', rehabCost: '450000', rehabContingency: '10', monthlyHolding: '7500',
  otherProjectCosts: '50000', sellingCosts: '6', discountRate: '10', mcIterations: '2500',
  mcRentMin: '-10', mcRentMode: '2', mcRentMax: '10', mcVacancyMin: '3',
  mcVacancyMode: '6', mcVacancyMax: '14', mcExpenseMin: '-3', mcExpenseMode: '3',
  mcExpenseMax: '15', mcExitCapMin: '5.75', mcExitCapMode: '6.75', mcExitCapMax: '8',
  mcInterestMin: '5.75', mcInterestMode: '6.75', mcInterestMax: '8.5',
  mcArvMin: '-15', mcArvMode: '0', mcArvMax: '10', mcRehabMin: '0',
  mcRehabMode: '10', mcRehabMax: '30',
};

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

const Field = ({ label, name, value, onChange, prefix, suffix, type = 'number', min = '0', step = 'any' }) => (
  <label className="studio-field">
    <span>{label}</span>
    <div>{prefix && <i>{prefix}</i>}<input name={name} value={value} onChange={onChange} type={type} min={min} step={step} />{suffix && <i>{suffix}</i>}</div>
  </label>
);

const SelectField = ({ label, name, value, onChange, children }) => (
  <label className="studio-field">
    <span>{label}</span>
    <div><select name={name} value={value} onChange={onChange}>{children}</select><ChevronDown /></div>
  </label>
);

const AutocompleteField = ({ label, name, value, onChange, suggestions, onSelect, placeholder, icon: Icon }) => (
  <label className="studio-field studio-autocomplete">
    <span>{label}</span>
    <div>{Icon && <Icon />}<input name={name} value={value} onChange={onChange} type="text" autoComplete="off" placeholder={placeholder} /></div>
    {value.length > 0 && suggestions.length > 0 && (
      <div className="studio-suggestions" role="listbox">
        {suggestions.map((suggestion) => (
          <button type="button" role="option" key={suggestion.id || suggestion.label} onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(suggestion)}>
            <MapPin /><span><strong>{suggestion.label}</strong><small>{suggestion.provider === 'mapbox' ? 'Live address result' : suggestion.kind === 'market' ? 'Market' : 'Review property'}</small></span>
          </button>
        ))}
      </div>
    )}
  </label>
);

const InvestmentCalculator = () => {
  const [form, setForm] = useState(initialForm);
  const [result, setResult] = useState(null);
  const [monteCarlo, setMonteCarlo] = useState(null);
  const [error, setError] = useState('');
  const [riskError, setRiskError] = useState('');
  const [loading, setLoading] = useState(false);
  const [riskLoading, setRiskLoading] = useState(false);
  const [propertyLoading, setPropertyLoading] = useState(false);
  const [propertyRecord, setPropertyRecord] = useState(null);
  const [addressSuggestions, setAddressSuggestions] = useState([]);
  const [marketSuggestions, setMarketSuggestions] = useState([]);
  const [selectedCases, setSelectedCases] = useState(['Committee case', 'Downside case']);
  const [resultMode, setResultMode] = useState('base');
  const backendUrl = useMemo(() => (process.env.REACT_APP_BACKEND_URL || '').replace(/\/$/, ''), []);
  const sessionToken = useMemo(() => globalThis.crypto?.randomUUID?.() || `session-${Date.now()}`, []);

  const n = (value) => Number(value || 0);
  const rate = (value) => n(value) / 100;

  useEffect(() => {
    const clean = form.address.trim().toLowerCase();
    if (!clean) { setAddressSuggestions([]); return undefined; }
    const local = LOCAL_ADDRESSES.filter((item) => item.label.toLowerCase().includes(clean)).slice(0, 6);
    setAddressSuggestions(local);
    const timer = window.setTimeout(async () => {
      try {
        const { data } = await axios.get(`${backendUrl}/api/v1/properties/suggest`, {
          params: { q: form.address, session_token: sessionToken },
        });
        if (Array.isArray(data?.suggestions)) {
          const merged = [...data.suggestions, ...local].filter((item, index, items) => items.findIndex((candidate) => candidate.label === item.label) === index);
          setAddressSuggestions(merged.slice(0, 8));
        }
      } catch { /* Local review suggestions remain available. */ }
    }, 325);
    return () => window.clearTimeout(timer);
  }, [backendUrl, form.address, sessionToken]);

  useEffect(() => {
    const clean = form.market.trim().toLowerCase();
    if (!clean) { setMarketSuggestions([]); return; }
    setMarketSuggestions(MARKET_OPTIONS.filter((market) => market.toLowerCase().startsWith(clean) || market.toLowerCase().includes(clean)).slice(0, 8).map((market) => ({ id: market, label: market, kind: 'market', provider: 'curated' })));
  }, [form.market]);

  const update = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const propertyTypeValue = (value = '') => {
    const normalized = value.toLowerCase();
    if (normalized.includes('multi') || normalized.includes('apartment')) return 'multifamily';
    if (normalized.includes('condo')) return 'condo';
    if (normalized.includes('office')) return 'office';
    if (normalized.includes('retail')) return 'retail';
    if (normalized.includes('industrial')) return 'industrial';
    if (normalized.includes('mixed')) return 'mixed_use';
    return 'single_family';
  };

  const applyProperty = (record) => {
    const market = [record.city, record.state].filter(Boolean).join(', ');
    setPropertyRecord(record);
    setForm((current) => ({
      ...current,
      address: record.formatted_address || current.address,
      market: market || current.market,
      propertyType: propertyTypeValue(record.property_type),
      units: record.property_type?.toLowerCase().includes('multi') ? current.units : '1',
      rentableSquareFeet: String(record.square_footage || current.rentableSquareFeet),
      purchasePrice: String(record.last_sale_price || record.price || current.purchasePrice),
      propertyTaxes: String(record.annual_taxes || current.propertyTaxes),
    }));
    setAddressSuggestions([]);
  };

  const selectAddress = async (suggestion) => {
    setForm((current) => ({ ...current, address: suggestion.label }));
    setAddressSuggestions([]);
    if (suggestion.property) {
      applyProperty({
        formatted_address: suggestion.label, city: suggestion.property.city,
        state: suggestion.property.state, property_type: suggestion.property.propertyType,
        square_footage: suggestion.property.sqft, last_sale_price: suggestion.property.price,
        annual_taxes: suggestion.property.taxHistory?.[0]?.amount, bedrooms: suggestion.property.beds,
        bathrooms: suggestion.property.baths, year_built: suggestion.property.yearBuilt,
        provider: 'review', is_demo: true,
      });
      return;
    }
    setPropertyLoading(true); setError('');
    try {
      const { data } = await axios.get(`${backendUrl}/api/v1/properties/lookup`, { params: { address: suggestion.label } });
      applyProperty(data.property);
    } catch (lookupError) {
      setError(lookupError.response?.data?.detail || 'Address selected. Live property details require the configured property-data provider.');
    } finally { setPropertyLoading(false); }
  };

  const operatingExpenses = () => n(form.propertyTaxes) + n(form.insurance) + n(form.repairsMaintenance) + n(form.utilities) + n(form.payrollAdmin);

  const buildRequest = () => {
    const common = {
      strategy: form.strategy,
      property: {
        property_type: form.propertyType, unit_count: Math.max(1, n(form.units)),
        rentable_square_feet: n(form.rentableSquareFeet) || null,
        market: form.market || null, currency: 'USD',
      },
      acquisition: {
        purchase_price: n(form.purchasePrice), closing_costs: n(form.closingCosts),
        due_diligence_costs: n(form.dueDiligenceCosts), initial_capex: n(form.initialCapex),
        hold_months: Math.max(1, n(form.holdMonths)),
      },
      debt: n(form.ltv) > 0 ? [{
        name: 'Senior acquisition loan', loan_to_value: rate(form.ltv),
        annual_interest_rate: rate(form.interestRate), amortization_years: Math.max(1, n(form.amortizationYears)),
        interest_only_months: Math.max(0, n(form.interestOnlyMonths)),
        term_months: Math.max(12, n(form.loanTermYears) * 12), origination_fee_rate: rate(form.originationFee),
      }] : [],
      exit: { selling_cost_rate: rate(form.sellingCosts) },
      assumptions: { annual_discount_rate: rate(form.discountRate) },
    };
    if (form.strategy === 'rental') {
      return {
        ...common,
        operating: {
          gross_scheduled_rent: n(form.annualRent), other_income: n(form.otherIncome),
          vacancy_rate: rate(form.vacancy), operating_expenses: operatingExpenses(),
          management_fee_rate: rate(form.managementFee), replacement_reserves: n(form.reserves),
          annual_below_noi_costs: n(form.annualBelowNoiCosts),
          annual_income_growth_rate: rate(form.incomeGrowth), annual_expense_growth_rate: rate(form.expenseGrowth),
        },
        exit: {
          ...common.exit,
          ...(n(form.explicitSalePrice) > 0
            ? { explicit_sale_price: n(form.explicitSalePrice) }
            : n(form.exitCap) > 0 ? { exit_cap_rate: rate(form.exitCap) } : {}),
        },
      };
    }
    return {
      ...common,
      flip: {
        after_repair_value: n(form.arv), rehab_cost: n(form.rehabCost),
        rehab_contingency_rate: rate(form.rehabContingency), monthly_holding_costs: n(form.monthlyHolding),
        other_project_costs: n(form.otherProjectCosts),
      },
    };
  };

  const analyze = async (event) => {
    event.preventDefault();
    setLoading(true); setError(''); setResult(null); setResultMode('base');
    const request = buildRequest();
    try {
      if (!backendUrl) setResult(analyzeDealLocally(request));
      else {
        const { data } = await axios.post(`${backendUrl}/api/v1/deals/analyze`, request);
        setResult(data);
      }
    } catch (requestError) {
      try { setResult(analyzeDealLocally(request)); }
      catch (calculationError) {
        const detail = requestError.response?.data?.detail;
        setError(calculationError.message || (typeof detail === 'string' ? detail : 'The analysis could not be completed. Review the assumptions and try again.'));
      }
    } finally { setLoading(false); }
  };

  const scenarioDrivers = (caseName) => {
    const stress = caseName === 'Severe stress';
    const downside = caseName === 'Downside case';
    const scale = stress ? 1.75 : downside ? 1.25 : 1;
    if (form.strategy === 'rental') return {
      rent_change: { minimum: rate(n(form.mcRentMin) * scale), mode: rate(form.mcRentMode), maximum: rate(form.mcRentMax) },
      vacancy_rate: { minimum: rate(form.mcVacancyMin), mode: rate(n(form.mcVacancyMode) * (downside ? 1.2 : 1)), maximum: Math.min(.75, rate(n(form.mcVacancyMax) * scale)) },
      operating_expense_change: { minimum: rate(form.mcExpenseMin), mode: rate(form.mcExpenseMode), maximum: rate(n(form.mcExpenseMax) * scale) },
      exit_cap_rate: { minimum: rate(form.mcExitCapMin), mode: rate(n(form.mcExitCapMode) * (downside ? 1.05 : 1)), maximum: rate(n(form.mcExitCapMax) * scale) },
      interest_rate: { minimum: rate(form.mcInterestMin), mode: rate(form.mcInterestMode), maximum: rate(n(form.mcInterestMax) * scale) },
    };
    return {
      after_repair_value_change: { minimum: rate(n(form.mcArvMin) * scale), mode: rate(form.mcArvMode), maximum: rate(form.mcArvMax) },
      rehab_cost_change: { minimum: rate(form.mcRehabMin), mode: rate(form.mcRehabMode), maximum: rate(n(form.mcRehabMax) * scale) },
      interest_rate: { minimum: rate(form.mcInterestMin), mode: rate(form.mcInterestMode), maximum: rate(n(form.mcInterestMax) * scale) },
    };
  };

  const runRiskAnalysis = async () => {
    if (!selectedCases.length) { setRiskError('Select at least one Monte Carlo case.'); return; }
    setRiskLoading(true); setRiskError(''); setMonteCarlo(null); setResultMode('risk');
    try {
      const payload = {
        deal: buildRequest(),
        scenarios: selectedCases.map((name, index) => ({
          name, iterations: n(form.mcIterations), seed: 2026 + index * 97, drivers: scenarioDrivers(name),
        })),
      };
      if (!backendUrl) setMonteCarlo(runMonteCarloLocally(payload));
      else {
        const { data } = await axios.post(`${backendUrl}/api/v1/deals/monte-carlo`, payload);
        setMonteCarlo(data);
      }
    } catch (requestError) {
      try {
        const payload = { deal: buildRequest(), scenarios: selectedCases.map((name, index) => ({ name, iterations: n(form.mcIterations), seed: 2026 + index * 97, drivers: scenarioDrivers(name) })) };
        setMonteCarlo(runMonteCarloLocally(payload));
      } catch (calculationError) { setRiskError(calculationError.message || requestError.response?.data?.detail || 'Risk analysis could not be completed.'); }
    } finally { setRiskLoading(false); }
  };

  const toggleCase = (caseName) => setSelectedCases((current) => current.includes(caseName) ? current.filter((item) => item !== caseName) : [...current, caseName]);

  const metricKeys = form.strategy === 'rental'
    ? ['irr', 'cash_on_cash', 'cap_rate', 'dscr', 'noi', 'npv', 'equity_multiple', 'break_even_occupancy']
    : ['flip_profit', 'flip_roi', 'irr', 'npv', 'equity_multiple', 'ltv', 'ltc', 'max_offer_70_rule'];

  const displayMetric = (metric) => {
    if (!metric || metric.value === null) return '—';
    if (metric.unit === 'USD') return money.format(metric.value);
    if (metric.unit === 'decimal_rate') return `${number.format(metric.value * 100)}%`;
    if (metric.unit === 'multiple') return `${number.format(metric.value)}×`;
    return number.format(metric.value);
  };

  const labels = {
    irr: 'Projected IRR', cash_on_cash: 'Cash-on-cash', cap_rate: 'Going-in cap rate', dscr: 'DSCR',
    noi: 'Year-one NOI', npv: 'Net present value', equity_multiple: 'Equity multiple',
    break_even_occupancy: 'Break-even occupancy', flip_profit: 'Projected profit', flip_roi: 'Flip ROI',
    ltv: 'Loan-to-value', ltc: 'Loan-to-cost', max_offer_70_rule: '70% screening threshold',
  };

  const summaryFormat = (key, value) => value == null ? 'Not defined' : key === 'npv' || key === 'flip_profit' ? money.format(value) : key === 'equity_multiple' || key === 'dscr' ? `${number.format(value)}×` : `${number.format(value * 100)}%`;

  return (
    <main className="deal-studio-page">
      <header className="deal-studio-hero">
        <div>
          <p className="eyebrow eyebrow--light"><span /> DIAMOND ECHO DEAL ANALYSIS</p>
          <h1>Underwrite with<br /><em>absolute clarity.</em></h1>
          <p>Address-enriched, institutional-grade analysis for a single residence, rental portfolio, multifamily acquisition, commercial asset, or fix-and-flip.</p>
        </div>
        <div className="deal-studio-hero__seal"><BarChart3 /><span>FORMULA VERSION<br />1.1 · MONTE CARLO</span></div>
      </header>

      <section className="deal-studio-shell">
        <form className="deal-studio-form" onSubmit={analyze}>
          <div className="studio-strategy" role="group" aria-label="Investment strategy">
            <button type="button" className={form.strategy === 'rental' ? 'is-active' : ''} onClick={() => setForm((f) => ({ ...f, strategy: 'rental' }))}><Building2 /> Rental & commercial</button>
            <button type="button" className={form.strategy === 'flip' ? 'is-active' : ''} onClick={() => setForm((f) => ({ ...f, strategy: 'flip', propertyType: f.propertyType === 'multifamily' ? 'single_family' : f.propertyType }))}><Home /> Fix & flip</button>
          </div>

          <fieldset>
            <legend><span>01</span> Property intelligence</legend>
            <div className="studio-property-search">
              <AutocompleteField label="Property address" name="address" value={form.address} onChange={update} suggestions={addressSuggestions} onSelect={selectAddress} placeholder="Start typing any U.S. address" icon={MapPin} />
              {propertyLoading && <p className="studio-provider-note"><Loader2 className="spin" /> Retrieving public-record details…</p>}
              {!propertyLoading && <p className="studio-provider-note"><Database /> Mapbox autocomplete + RentCast public records when provider credentials are configured.</p>}
            </div>
            {propertyRecord && (
              <div className="studio-property-card">
                <div><span>{propertyRecord.is_demo ? 'REVIEW RECORD' : 'PUBLIC RECORD'}</span><strong>{propertyRecord.formatted_address}</strong><small>{propertyRecord.provider || 'Property data provider'}</small></div>
                <dl>
                  <div><dt>TYPE</dt><dd>{propertyRecord.property_type || 'Verify'}</dd></div>
                  <div><dt>BUILT</dt><dd>{propertyRecord.year_built || '—'}</dd></div>
                  <div><dt>SIZE</dt><dd>{propertyRecord.square_footage ? `${number.format(propertyRecord.square_footage)} sf` : '—'}</dd></div>
                  <div><dt>TAXES</dt><dd>{propertyRecord.annual_taxes ? money.format(propertyRecord.annual_taxes) : '—'}</dd></div>
                </dl>
              </div>
            )}
            <div className="studio-field-grid">
              <SelectField label="Asset type" name="propertyType" value={form.propertyType} onChange={update}>
                <option value="single_family">Single-family</option><option value="condo">Condominium</option>
                <option value="multifamily">Multifamily</option><option value="office">Office</option>
                <option value="retail">Retail</option><option value="industrial">Industrial</option>
                <option value="mixed_use">Mixed-use</option><option value="hospitality">Hospitality</option>
              </SelectField>
              <AutocompleteField label="Market" name="market" value={form.market} onChange={update} suggestions={marketSuggestions} onSelect={(item) => { setForm((current) => ({ ...current, market: item.label })); setMarketSuggestions([]); }} placeholder="Type one letter" />
              <Field label="Units" name="units" value={form.units} onChange={update} step="1" />
              <Field label="Rentable square feet" name="rentableSquareFeet" value={form.rentableSquareFeet} onChange={update} suffix="sf" />
              <Field label="Purchase price" name="purchasePrice" value={form.purchasePrice} onChange={update} prefix="$" />
              <Field label="Closing costs" name="closingCosts" value={form.closingCosts} onChange={update} prefix="$" />
              <Field label="Due diligence" name="dueDiligenceCosts" value={form.dueDiligenceCosts} onChange={update} prefix="$" />
              <Field label="Initial capital work" name="initialCapex" value={form.initialCapex} onChange={update} prefix="$" />
              <Field label="Hold period" name="holdMonths" value={form.holdMonths} onChange={update} suffix="months" step="1" />
            </div>
          </fieldset>

          <fieldset>
            <legend><span>02</span> Capital structure</legend>
            <div className="studio-field-grid">
              <Field label="Loan-to-value" name="ltv" value={form.ltv} onChange={update} suffix="%" />
              <Field label="Interest rate" name="interestRate" value={form.interestRate} onChange={update} suffix="%" />
              <Field label="Amortization" name="amortizationYears" value={form.amortizationYears} onChange={update} suffix="years" step="1" />
              <Field label="Interest-only period" name="interestOnlyMonths" value={form.interestOnlyMonths} onChange={update} suffix="months" step="1" />
              <Field label="Loan term" name="loanTermYears" value={form.loanTermYears} onChange={update} suffix="years" step="1" />
              <Field label="Origination fee" name="originationFee" value={form.originationFee} onChange={update} suffix="%" />
              <Field label="Discount rate" name="discountRate" value={form.discountRate} onChange={update} suffix="%" />
              <Field label="Selling costs" name="sellingCosts" value={form.sellingCosts} onChange={update} suffix="%" />
            </div>
          </fieldset>

          {form.strategy === 'rental' ? (
            <fieldset>
              <legend><span>03</span> Operations & exit</legend>
              <div className="studio-field-grid">
                <Field label="Annual scheduled rent" name="annualRent" value={form.annualRent} onChange={update} prefix="$" />
                <Field label="Other annual income" name="otherIncome" value={form.otherIncome} onChange={update} prefix="$" />
                <Field label="Vacancy" name="vacancy" value={form.vacancy} onChange={update} suffix="%" />
                <Field label="Property taxes" name="propertyTaxes" value={form.propertyTaxes} onChange={update} prefix="$" />
                <Field label="Insurance" name="insurance" value={form.insurance} onChange={update} prefix="$" />
                <Field label="Repairs & maintenance" name="repairsMaintenance" value={form.repairsMaintenance} onChange={update} prefix="$" />
                <Field label="Utilities" name="utilities" value={form.utilities} onChange={update} prefix="$" />
                <Field label="Payroll & administration" name="payrollAdmin" value={form.payrollAdmin} onChange={update} prefix="$" />
                <Field label="Management fee" name="managementFee" value={form.managementFee} onChange={update} suffix="%" />
                <Field label="Replacement reserves" name="reserves" value={form.reserves} onChange={update} prefix="$" />
                <Field label="TI / leasing / capital" name="annualBelowNoiCosts" value={form.annualBelowNoiCosts} onChange={update} prefix="$" />
                <Field label="Income growth" name="incomeGrowth" value={form.incomeGrowth} onChange={update} suffix="%" />
                <Field label="Expense growth" name="expenseGrowth" value={form.expenseGrowth} onChange={update} suffix="%" />
                <Field label="Exit cap rate" name="exitCap" value={form.exitCap} onChange={update} suffix="%" />
                <Field label="Expected sale price / terminal value" name="explicitSalePrice" value={form.explicitSalePrice} onChange={update} prefix="$" />
              </div>
            </fieldset>
          ) : (
            <fieldset>
              <legend><span>03</span> Project & disposition</legend>
              <div className="studio-field-grid">
                <Field label="After-repair value" name="arv" value={form.arv} onChange={update} prefix="$" />
                <Field label="Rehabilitation budget" name="rehabCost" value={form.rehabCost} onChange={update} prefix="$" />
                <Field label="Rehab contingency" name="rehabContingency" value={form.rehabContingency} onChange={update} suffix="%" />
                <Field label="Monthly holding costs" name="monthlyHolding" value={form.monthlyHolding} onChange={update} prefix="$" />
                <Field label="Other project costs" name="otherProjectCosts" value={form.otherProjectCosts} onChange={update} prefix="$" />
              </div>
            </fieldset>
          )}

          <fieldset className="studio-monte-carlo">
            <legend><span>04</span> Monte Carlo risk laboratory</legend>
            <div className="studio-case-picker">
              {['Committee case', 'Downside case', 'Severe stress'].map((caseName) => (
                <button type="button" key={caseName} className={selectedCases.includes(caseName) ? 'is-active' : ''} onClick={() => toggleCase(caseName)}><CheckCircle2 /> {caseName}</button>
              ))}
            </div>
            <div className="studio-field-grid">
              <SelectField label="Iterations per case" name="mcIterations" value={form.mcIterations} onChange={update}><option value="1000">1,000</option><option value="2500">2,500</option><option value="5000">5,000</option><option value="10000">10,000</option></SelectField>
              {form.strategy === 'rental' ? <>
                <Field label="Rent change · low" name="mcRentMin" value={form.mcRentMin} onChange={update} suffix="%" min="-90" />
                <Field label="Rent change · mode" name="mcRentMode" value={form.mcRentMode} onChange={update} suffix="%" min="-90" />
                <Field label="Rent change · high" name="mcRentMax" value={form.mcRentMax} onChange={update} suffix="%" min="-90" />
                <Field label="Vacancy · low" name="mcVacancyMin" value={form.mcVacancyMin} onChange={update} suffix="%" />
                <Field label="Vacancy · mode" name="mcVacancyMode" value={form.mcVacancyMode} onChange={update} suffix="%" />
                <Field label="Vacancy · high" name="mcVacancyMax" value={form.mcVacancyMax} onChange={update} suffix="%" />
                <Field label="Exit cap · low" name="mcExitCapMin" value={form.mcExitCapMin} onChange={update} suffix="%" />
                <Field label="Exit cap · mode" name="mcExitCapMode" value={form.mcExitCapMode} onChange={update} suffix="%" />
                <Field label="Exit cap · high" name="mcExitCapMax" value={form.mcExitCapMax} onChange={update} suffix="%" />
              </> : <>
                <Field label="ARV change · low" name="mcArvMin" value={form.mcArvMin} onChange={update} suffix="%" min="-90" />
                <Field label="ARV change · mode" name="mcArvMode" value={form.mcArvMode} onChange={update} suffix="%" min="-90" />
                <Field label="ARV change · high" name="mcArvMax" value={form.mcArvMax} onChange={update} suffix="%" min="-90" />
                <Field label="Rehab overrun · low" name="mcRehabMin" value={form.mcRehabMin} onChange={update} suffix="%" />
                <Field label="Rehab overrun · mode" name="mcRehabMode" value={form.mcRehabMode} onChange={update} suffix="%" />
                <Field label="Rehab overrun · high" name="mcRehabMax" value={form.mcRehabMax} onChange={update} suffix="%" />
              </>}
            </div>
            <div className="studio-risk-actions">
              <p><TrendingUp /> Reproducible triangular distributions, percentile outcomes, downside probabilities, and excluded-iteration disclosure.</p>
              <button type="button" onClick={runRiskAnalysis} disabled={riskLoading}>{riskLoading ? <><Loader2 className="spin" /> Simulating</> : <>Run Monte Carlo <BarChart3 /></>}</button>
            </div>
          </fieldset>

          <div className="studio-submit-row">
            <p><ShieldCheck /> Every metric includes its formula, components, assumptions, warnings, and audit version.</p>
            <div className="studio-submit-actions">
              <a href="/DiamondEcho_Deal_Analysis_Model.xlsx" download><FileSpreadsheet /> Download Excel model <Download /></a>
              <button type="submit" disabled={loading}>{loading ? <><Loader2 className="spin" /> Analyzing</> : <>Run base analysis <ArrowRight /></>}</button>
            </div>
          </div>
        </form>

        <aside className="deal-studio-results">
          <div className="deal-studio-results__head"><span><Sparkles /> INVESTMENT COMMITTEE OUTPUT</span>{result && <small>{result.formula_version}</small>}</div>
          <div className="studio-result-tabs"><button className={resultMode === 'base' ? 'is-active' : ''} onClick={() => setResultMode('base')}>Base case</button><button className={resultMode === 'risk' ? 'is-active' : ''} onClick={() => setResultMode('risk')}>Monte Carlo</button></div>
          {resultMode === 'base' && !result && !error && (
            <div className="studio-empty"><CircleDollarSign /><h2>Your decision canvas</h2><p>Complete the assumptions and run an analysis. DiamondEcho will calculate returns, debt coverage, value creation, and risk signals without hidden inputs.</p></div>
          )}
          {resultMode === 'base' && error && <div className="studio-error"><AlertCircle /><h2>Analysis needs attention</h2><p>{error}</p><button onClick={() => setError('')}><RotateCcw /> Review inputs</button></div>}
          {resultMode === 'base' && result && (
            <div className="studio-result">
              <div className="studio-result__verdict"><span>MODEL STATUS</span><strong>Analysis complete</strong><p>{result.calculation_mode === 'browser' ? 'Calculated on this device with the same transparent underwriting conventions.' : result.strategy === 'rental' ? 'Income, financing, and exit assumptions have been modeled.' : 'Acquisition, project, holding, and disposition costs have been modeled.'}</p></div>
              <div className="studio-metrics">
                {metricKeys.map((key) => {
                  const metric = result.metrics[key];
                  return <article key={key}><small>{labels[key]}</small><strong>{displayMetric(metric)}</strong><p>{metric?.formula}</p>{metric?.warning && <span>{metric.warning}</span>}</article>;
                })}
              </div>
              {result.warnings?.length > 0 && <div className="studio-warnings"><span>ASSUMPTIONS TO VERIFY</span>{result.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
            </div>
          )}
          {resultMode === 'risk' && riskError && <div className="studio-error"><AlertCircle /><h2>Risk analysis needs attention</h2><p>{riskError}</p><button onClick={() => setRiskError('')}><RotateCcw /> Review scenarios</button></div>}
          {resultMode === 'risk' && !monteCarlo && !riskError && <div className="studio-empty"><BarChart3 /><h2>Distribution before decision</h2><p>Select multiple cases and run Monte Carlo to see percentile returns, downside frequency, and the range of plausible outcomes.</p></div>}
          {resultMode === 'risk' && monteCarlo && <div className="studio-risk-results">
            {monteCarlo.scenarios.map((scenario) => {
              const primaryKey = form.strategy === 'rental' ? 'irr' : 'flip_profit';
              const summary = scenario.summaries[primaryKey];
              return <article key={scenario.name}><span>{scenario.name.toUpperCase()}</span><h3>{summaryFormat(primaryKey, summary.p50)}</h3><p>Median {labels[primaryKey] || primaryKey} · {number.format(summary.probability_above_zero * 100)}% probability above zero</p><dl><div><dt>P10</dt><dd>{summaryFormat(primaryKey, summary.p10)}</dd></div><div><dt>P50</dt><dd>{summaryFormat(primaryKey, summary.p50)}</dd></div><div><dt>P90</dt><dd>{summaryFormat(primaryKey, summary.p90)}</dd></div></dl><small>{scenario.iterations_completed.toLocaleString()} valid iterations · seed {scenario.seed}</small></article>;
            })}
          </div>}
          <p className="studio-disclaimer">Illustrative analysis only. Not an appraisal, credit decision, offer, tax opinion, or investment recommendation. Verify property records and every assumption with qualified professionals.</p>
        </aside>
      </section>
    </main>
  );
};

export default InvestmentCalculator;
