import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, Home, Info, Search } from 'lucide-react';
import {
  amount, DEFAULT_PMI_RATE, DEFAULT_PROPERTY_TAX_RATE, LOAN_PROGRAMS, loanProgram, mortgagePrefillFromSearch, paymentParts, simulateMortgage,
} from '../../lib/mortgage';
import { CalcField, CalcSelect, percent, Segmented, StickyTotal, tidy, usd, usdCents } from './fields';
import PaymentDonut from './PaymentDonut';
import './calculators.css';

// Example figures only. They are not a listing, a rate quote or an insurance
// quote, and the page says so above the form.
export const EXAMPLE_MORTGAGE = {
  price: '450000',
  downPaymentMode: 'percent',
  downPayment: '20',
  program: 'fixed30',
  ratePct: '6.5',
  laterRatePct: '',
  propertyTaxMode: 'percent',
  propertyTax: String(DEFAULT_PROPERTY_TAX_RATE),
  insuranceMode: 'year',
  insurance: '1800',
  hoaMonthly: '0',
  pmiRatePct: String(DEFAULT_PMI_RATE),
};

// A link may carry a listing's price, yearly taxes and monthly HOA fee.
export const mortgageFormFromSearch = (search) => {
  const prefill = mortgagePrefillFromSearch(search);
  if (!prefill) return { form: EXAMPLE_MORTGAGE, prefilled: [] };
  const form = { ...EXAMPLE_MORTGAGE, price: String(prefill.price) };
  const prefilled = ['price'];
  if (prefill.taxes !== null) { form.propertyTaxMode = 'amount'; form.propertyTax = String(prefill.taxes); prefilled.push('yearly property taxes'); }
  if (prefill.hoa !== null) { form.hoaMonthly = String(prefill.hoa); prefilled.push('monthly HOA fee'); }
  return { form, prefilled };
};

const listed = (words) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);
const DOLLAR_PERCENT = [{ value: 'amount', label: '$', name: 'Dollars' }, { value: 'percent', label: '%', name: 'Percent of the price' }];
const YEAR_MONTH = [{ value: 'year', label: 'Year', name: 'Per year' }, { value: 'month', label: 'Month', name: 'Per month' }];

const MortgageSimulator = ({ search = '', hidden = false }) => {
  const prefillKey = useMemo(() => {
    const prefill = mortgagePrefillFromSearch(search);
    return prefill ? [prefill.price, prefill.taxes, prefill.hoa].join('|') : '';
  }, [search]);
  const [{ form, prefilled }, setState] = useState(() => mortgageFormFromSearch(search));
  const setForm = (change) => setState((current) => ({ ...current, form: typeof change === 'function' ? change(current.form) : change }));
  const [view, setView] = useState('year');
  const loadedKey = useRef(prefillKey);
  const resultsRef = useRef(null);

  // Following a different listing link while the page is open loads its
  // figures. Switching between the tools does not touch what was typed.
  useEffect(() => {
    if (prefillKey === loadedKey.current) return;
    loadedKey.current = prefillKey;
    if (prefillKey) setState(mortgageFormFromSearch(search));
  }, [prefillKey, search]);

  const result = useMemo(() => simulateMortgage(form), [form]);
  const program = loanProgram(form.program);
  const price = amount(form.price);

  const update = (event) => {
    const { name, value } = event.target;
    setForm((current) => {
      const next = { ...current, [name]: value };
      // Choosing an adjustable loan for the first time offers a later rate two
      // points above the starting rate as an example, rather than none.
      if (name === 'program' && loanProgram(value).fixedYears && String(current.laterRatePct).trim() === '') next.laterRatePct = tidy(amount(current.ratePct) + 2, 3);
      return next;
    });
  };

  // Switching the unit keeps the scenario: 20% of $450,000 becomes $90,000.
  const switchUnit = (modeField, valueField, convert) => (mode) => setForm((current) => (current[modeField] === mode
    ? current
    : { ...current, [modeField]: mode, [valueField]: convert(amount(current[valueField]), mode, amount(current.price)) }));
  const dollarsOrPercent = (value, mode, base) => (base <= 0 ? '' : mode === 'amount' ? tidy((base * value) / 100, 0) : tidy((value / base) * 100, 3));
  const yearOrMonth = (value, mode) => (mode === 'month' ? tidy(value / 12, 2) : tidy(value * 12, 2));

  const parts = paymentParts(result);
  const pmiEnd = result.pmi.endsAfterMonth;
  const showPmi = result.pmi.required;
  const fmt = view === 'month' ? usdCents : usd;

  return (
    <section className="deal-studio-shell calc-shell" aria-label="Buyer mortgage simulator" hidden={hidden}>
      <form className="deal-studio-form" onSubmit={(event) => event.preventDefault()} noValidate>
        {result.valid && <StickyTotal label="Est. monthly payment" value={usd.format(result.monthly.total)} targetRef={resultsRef} />}
        <p className="studio-provider-note calc-intro" role="status">
          <Info />
          {prefilled.length > 0
            ? `The ${listed(prefilled)} came from the link you followed. Check ${prefilled.length > 1 ? 'them' : 'it'} against the listing. The other figures are examples: replace them with your own.`
            : 'The figures below are an example, not a listing or a rate quote. Replace them with your own. Nothing you type here is saved or sent.'}
        </p>

        <fieldset>
          <legend><span>01</span> Price and down payment</legend>
          <div className="studio-field-grid calc-grid--2">
            <CalcField label="Home purchase price" name="price" value={form.price} onChange={update} prefix="$" />
            <CalcField
              label="Down payment" name="downPayment" value={form.downPayment} onChange={update}
              prefix={form.downPaymentMode === 'amount' ? '$' : undefined}
              units={DOLLAR_PERCENT} unit={form.downPaymentMode} unitsLabel="Down payment entered as"
              onUnitChange={switchUnit('downPaymentMode', 'downPayment', dollarsOrPercent)}
              hint={price > 0 ? `${usd.format(result.downPayment)} down (${percent(result.downPaymentPct)}), so the loan is ${usd.format(result.loanAmount)}.` : 'Enter a price first.'}
            />
          </div>
        </fieldset>

        <fieldset>
          <legend><span>02</span> Loan</legend>
          <div className="studio-field-grid calc-grid--2">
            <CalcSelect label="Loan term" name="program" value={form.program} onChange={update}>
              {LOAN_PROGRAMS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </CalcSelect>
            <CalcField
              label={program.fixedYears ? `Interest rate for the first ${program.fixedYears} years` : 'Interest rate'} name="ratePct" value={form.ratePct} onChange={update} suffix="%"
              hint="Example only. Use the rate a lender quotes you."
            />
            {program.fixedYears && (
              <CalcField
                label={`Rate after year ${program.fixedYears} (your assumption)`} name="laterRatePct" value={form.laterRatePct} onChange={update} suffix="%"
                hint="Nobody knows this rate today. Your loan's index, margin and caps decide it, and it can change again later. This schedule moves the rate once."
              />
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend><span>03</span> Taxes, insurance and fees</legend>
          <div className="studio-field-grid calc-grid--2">
            <CalcField
              label="Annual property taxes" name="propertyTax" value={form.propertyTax} onChange={update}
              prefix={form.propertyTaxMode === 'amount' ? '$' : undefined}
              units={DOLLAR_PERCENT} unit={form.propertyTaxMode} unitsLabel="Property taxes entered as"
              onUnitChange={switchUnit('propertyTaxMode', 'propertyTax', dollarsOrPercent)}
              hint={form.propertyTaxMode === 'percent'
                ? `${usd.format(result.annualTax)} a year. ${percent(DEFAULT_PROPERTY_TAX_RATE)} of the price is a placeholder, not a county's rate: use the listing's tax figure when you have it.`
                : `${usd.format(result.monthly.propertyTax)} a month.`}
            />
            <CalcField
              label="Homeowners insurance" name="insurance" value={form.insurance} onChange={update} prefix="$"
              units={YEAR_MONTH} unit={form.insuranceMode} unitsLabel="Insurance entered per"
              onUnitChange={switchUnit('insuranceMode', 'insurance', yearOrMonth)}
              hint="Example only. Ask an insurer for a quote on the home."
            />
            <CalcField label="HOA / condo fees" name="hoaMonthly" value={form.hoaMonthly} onChange={update} prefix="$" suffix="/ month" hint="From the listing, if the home has an association." />
            {showPmi ? (
              <CalcField
                label="Mortgage insurance (PMI) rate" name="pmiRatePct" value={form.pmiRatePct} onChange={update} suffix="% of loan / year"
                hint={`Added because the down payment is under 20%: ${usdCents.format(result.pmi.monthly)} a month. The rate is an example; a lender sets it from your credit and down payment.`}
              />
            ) : (
              <p className="calc-quiet-note"><Info /> No mortgage insurance: {result.loanAmount > 0 ? 'the down payment is 20% or more.' : 'there is no loan.'}</p>
            )}
          </div>
        </fieldset>
      </form>

      <aside className="deal-studio-results calc-results" aria-label="Monthly payment estimate" ref={resultsRef} tabIndex={-1}>
        <div className="deal-studio-results__head"><span><Home /> MONTHLY PAYMENT ESTIMATE</span><small>{result.version}</small></div>
        {!result.valid ? (
          <div className="studio-empty"><Home /><h2>Enter a purchase price</h2><p>The payment, its parts and the loan schedule appear here as you type.</p></div>
        ) : (
          <>
            <div className="calc-hero" aria-live="polite">
              <span>TOTAL ESTIMATED MONTHLY PAYMENT</span>
              <strong>{usd.format(result.monthly.total)}</strong>
              <p>
                {program.label}{result.loanAmount > 0 ? ` at ${percent(result.rate)}` : ''} on a {usd.format(result.loanAmount)} loan
                {result.adjustable ? `, for the first ${result.adjustable.fixedYears} years` : ''}.
              </p>
            </div>

            {result.adjustable && (
              <div className="calc-callout" role="note">
                <AlertCircle />
                <p>
                  <strong>After year {result.adjustable.fixedYears}: {usd.format(result.adjustable.totalAfter)} a month</strong> if the rate moves to {percent(result.adjustable.laterRate)},
                  the figure you entered. Principal and interest go from {usd.format(result.monthly.principalInterest)} to {usd.format(result.adjustable.principalInterestAfter)}.
                </p>
              </div>
            )}

            <PaymentDonut parts={parts} total={result.monthly.total} />

            <dl className="calc-stats">
              <div><dt>Loan amount</dt><dd>{usd.format(result.loanAmount)}</dd></div>
              <div><dt>Down payment</dt><dd>{usd.format(result.downPayment)} <small>{percent(result.downPaymentPct)}</small></dd></div>
              <div><dt>Interest over the loan</dt><dd>{usd.format(result.totals.interest)}</dd></div>
              <div>
                <dt>Mortgage insurance</dt>
                <dd>{showPmi && pmiEnd ? <>{usd.format(result.pmi.total)} <small>ends after month {pmiEnd} (year {Math.ceil(pmiEnd / 12)})</small></> : 'None'}</dd>
              </div>
            </dl>

            {result.notes.length > 0 && <ul className="calc-notes">{result.notes.map((note) => <li key={note}>{note}</li>)}</ul>}

            {result.schedule.length > 0 && (
              <section className="calc-schedule" aria-label="Amortization schedule">
                <div className="calc-schedule__head">
                  <h3>Amortization schedule</h3>
                  <Segmented label="Show the schedule by" value={view} onChange={setView} options={[{ value: 'year', label: 'Yearly' }, { value: 'month', label: 'Monthly' }]} />
                </div>
                <div className="calc-table-scroll" role="region" aria-label={`Amortization schedule, ${view === 'year' ? 'year by year' : 'month by month'}`} tabIndex={0}>
                  <table className="calc-table">
                    <thead>
                      <tr>
                        <th scope="col">{view === 'year' ? 'Year' : 'Month'}</th>
                        <th scope="col">Principal</th>
                        <th scope="col">Interest</th>
                        {showPmi && <th scope="col">PMI</th>}
                        <th scope="col">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(view === 'year' ? result.years : result.schedule).map((row) => (
                        <tr key={view === 'year' ? row.year : row.month}>
                          <th scope="row">{view === 'year' ? row.year : row.month}</th>
                          <td>{fmt.format(row.principal)}</td>
                          <td>{fmt.format(row.interest)}</td>
                          {showPmi && <td>{row.pmi > 0 ? fmt.format(row.pmi) : '—'}</td>}
                          <td>{fmt.format(row.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {showPmi && <p className="calc-footnote">Mortgage insurance is shown ending when the balance is scheduled to reach 78% of the price, or halfway through the term if that comes first. That is the rule for conventional loans; FHA and other government loans work differently.</p>}
              </section>
            )}

            <div className="calc-cta">
              <Link className="mf-btn mf-btn--solid" to="/inquire?type=buyer&topic=pre-approval">Get pre-approved <ArrowRight /></Link>
              <Link className="mf-btn" to="/inquire?type=buyer">{prefilled.length > 0 ? 'Contact an agent about this property' : 'Contact an agent about this purchase'}</Link>
              <Link className="mf-btn" to="/search"><Search /> Search Georgia homes</Link>
            </div>
            <p className="calc-footnote">DiamondEcho is not a lender. Pre-approval comes from a lender: send a request and an agent can introduce you to one. The figures above are not sent with it.</p>
            <p className="studio-disclaimer">An estimate from the figures above. It is not a loan offer, a rate quote or a commitment to lend, and no lender has reviewed it. A lender's Loan Estimate states the actual payment. Taxes, insurance and association fees change over time.</p>
          </>
        )}
      </aside>
    </section>
  );
};

export default MortgageSimulator;
