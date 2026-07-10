import React, { useMemo, useState } from 'react';
import axios from 'axios';
import {
  AlertCircle, ArrowRight, BarChart3, Building2, CheckCircle2,
  ChevronDown, CircleDollarSign, Home, Loader2, RotateCcw, Sparkles
} from 'lucide-react';

const initialForm = {
  strategy: 'rental', propertyType: 'multifamily', market: 'Austin, TX', units: '12',
  purchasePrice: '3000000', closingCosts: '75000', initialCapex: '125000', holdMonths: '60',
  ltv: '65', interestRate: '6.75', amortizationYears: '30', originationFee: '1',
  annualRent: '360000', otherIncome: '18000', vacancy: '5', operatingExpenses: '126000',
  managementFee: '4', reserves: '30000', incomeGrowth: '3', expenseGrowth: '3', exitCap: '6.5',
  arv: '4200000', rehabCost: '450000', rehabContingency: '10', monthlyHolding: '7500',
  otherProjectCosts: '50000', sellingCosts: '6', discountRate: '10',
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

const InvestmentCalculator = () => {
  const [form, setForm] = useState(initialForm);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const backendUrl = useMemo(() => (process.env.REACT_APP_BACKEND_URL || '').replace(/\/$/, ''), []);

  const update = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };
  const n = (value) => Number(value || 0);
  const rate = (value) => n(value) / 100;

  const buildRequest = () => {
    const common = {
      strategy: form.strategy,
      property: {
        property_type: form.propertyType,
        unit_count: Math.max(1, n(form.units)),
        market: form.market || null,
        currency: 'USD',
      },
      acquisition: {
        purchase_price: n(form.purchasePrice),
        closing_costs: n(form.closingCosts),
        initial_capex: n(form.initialCapex),
        hold_months: Math.max(1, n(form.holdMonths)),
      },
      debt: n(form.ltv) > 0 ? [{
        name: 'Senior acquisition loan',
        loan_to_value: rate(form.ltv),
        annual_interest_rate: rate(form.interestRate),
        amortization_years: Math.max(1, n(form.amortizationYears)),
        interest_only_months: 0,
        term_months: 360,
        origination_fee_rate: rate(form.originationFee),
      }] : [],
      exit: { selling_cost_rate: rate(form.sellingCosts) },
      assumptions: { annual_discount_rate: rate(form.discountRate) },
    };

    if (form.strategy === 'rental') {
      return {
        ...common,
        operating: {
          gross_scheduled_rent: n(form.annualRent), other_income: n(form.otherIncome),
          vacancy_rate: rate(form.vacancy), operating_expenses: n(form.operatingExpenses),
          management_fee_rate: rate(form.managementFee), replacement_reserves: n(form.reserves),
          annual_income_growth_rate: rate(form.incomeGrowth), annual_expense_growth_rate: rate(form.expenseGrowth),
        },
        exit: { ...common.exit, exit_cap_rate: rate(form.exitCap) },
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
    setLoading(true); setError(''); setResult(null);
    try {
      const { data } = await axios.post(`${backendUrl}/api/v1/deals/analyze`, buildRequest());
      setResult(data);
    } catch (requestError) {
      const detail = requestError.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'The analysis service is unavailable. Confirm the backend is running and try again.');
    } finally { setLoading(false); }
  };

  const metricKeys = form.strategy === 'rental'
    ? ['irr', 'cash_on_cash', 'cap_rate', 'dscr', 'noi', 'npv', 'equity_multiple', 'break_even_occupancy']
    : ['flip_profit', 'flip_roi', 'irr', 'npv', 'equity_multiple', 'ltv', 'ltc', 'max_offer_70_rule'];

  const displayMetric = (key, metric) => {
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

  return (
    <main className="deal-studio-page">
      <header className="deal-studio-hero">
        <div>
          <p className="eyebrow eyebrow--light"><span /> DIAMOND ECHO INTELLIGENCE</p>
          <h1>Underwrite with<br /><em>absolute clarity.</em></h1>
          <p>Institutional-grade analysis for a single residence, rental portfolio, multifamily acquisition, commercial asset, or fix-and-flip.</p>
        </div>
        <div className="deal-studio-hero__seal"><BarChart3 /><span>FORMULA VERSION<br />1.0 · EXPLAINABLE</span></div>
      </header>

      <section className="deal-studio-shell">
        <form className="deal-studio-form" onSubmit={analyze}>
          <div className="studio-strategy" role="group" aria-label="Investment strategy">
            <button type="button" className={form.strategy === 'rental' ? 'is-active' : ''} onClick={() => setForm((f) => ({ ...f, strategy: 'rental' }))}><Building2 /> Rental & commercial</button>
            <button type="button" className={form.strategy === 'flip' ? 'is-active' : ''} onClick={() => setForm((f) => ({ ...f, strategy: 'flip', propertyType: f.propertyType === 'multifamily' ? 'single_family' : f.propertyType }))}><Home /> Fix & flip</button>
          </div>

          <fieldset>
            <legend><span>01</span> Asset & acquisition</legend>
            <div className="studio-field-grid">
              <SelectField label="Asset type" name="propertyType" value={form.propertyType} onChange={update}>
                <option value="single_family">Single-family</option><option value="condo">Condominium</option>
                <option value="multifamily">Multifamily</option><option value="office">Office</option>
                <option value="retail">Retail</option><option value="industrial">Industrial</option>
                <option value="mixed_use">Mixed-use</option><option value="hospitality">Hospitality</option>
              </SelectField>
              <Field label="Market" name="market" value={form.market} onChange={update} type="text" min={undefined} />
              <Field label="Units" name="units" value={form.units} onChange={update} step="1" />
              <Field label="Purchase price" name="purchasePrice" value={form.purchasePrice} onChange={update} prefix="$" />
              <Field label="Closing & diligence" name="closingCosts" value={form.closingCosts} onChange={update} prefix="$" />
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
                <Field label="Annual operating expenses" name="operatingExpenses" value={form.operatingExpenses} onChange={update} prefix="$" />
                <Field label="Management fee" name="managementFee" value={form.managementFee} onChange={update} suffix="%" />
                <Field label="Annual reserves" name="reserves" value={form.reserves} onChange={update} prefix="$" />
                <Field label="Income growth" name="incomeGrowth" value={form.incomeGrowth} onChange={update} suffix="%" />
                <Field label="Expense growth" name="expenseGrowth" value={form.expenseGrowth} onChange={update} suffix="%" />
                <Field label="Exit cap rate" name="exitCap" value={form.exitCap} onChange={update} suffix="%" />
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

          <div className="studio-submit-row">
            <p><CheckCircle2 /> Every metric includes its formula, components, assumptions, and warnings.</p>
            <button type="submit" disabled={loading}>{loading ? <><Loader2 className="spin" /> Analyzing</> : <>Run analysis <ArrowRight /></>}</button>
          </div>
        </form>

        <aside className="deal-studio-results">
          <div className="deal-studio-results__head"><span><Sparkles /> ANALYSIS OUTPUT</span>{result && <small>{result.formula_version}</small>}</div>
          {!result && !error && (
            <div className="studio-empty"><CircleDollarSign /><h2>Your decision canvas</h2><p>Complete the assumptions and run an analysis. DiamondEcho will calculate returns, debt coverage, value creation, and risk signals without hidden inputs.</p></div>
          )}
          {error && <div className="studio-error"><AlertCircle /><h2>Analysis needs attention</h2><p>{error}</p><button onClick={() => setError('')}><RotateCcw /> Review inputs</button></div>}
          {result && (
            <div className="studio-result">
              <div className="studio-result__verdict"><span>MODEL STATUS</span><strong>Analysis complete</strong><p>{result.strategy === 'rental' ? 'Income, financing, and exit assumptions have been modeled.' : 'Acquisition, project, holding, and disposition costs have been modeled.'}</p></div>
              <div className="studio-metrics">
                {metricKeys.map((key) => {
                  const metric = result.metrics[key];
                  return <article key={key}><small>{labels[key]}</small><strong>{displayMetric(key, metric)}</strong><p>{metric?.formula}</p>{metric?.warning && <span>{metric.warning}</span>}</article>;
                })}
              </div>
              {result.warnings?.length > 0 && <div className="studio-warnings"><span>ASSUMPTIONS TO VERIFY</span>{result.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
              <p className="studio-disclaimer">Illustrative analysis only. Not an appraisal, credit decision, offer, tax opinion, or investment recommendation. Verify every assumption with qualified professionals.</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
};

export default InvestmentCalculator;
