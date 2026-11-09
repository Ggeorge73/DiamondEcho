import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, Home, Info, Printer, Search, Wallet } from 'lucide-react';
import {
  amount, BUYDOWNS, CREDIT_BANDS, DEFAULT_PROPERTY_TAX_RATE, GEORGIA_COUNTIES, georgiaCounty, LOAN_PROGRAMS, LOAN_TYPES, loanProgram, loanType,
  mortgagePrefillFromSearch, paymentParts, simulateMortgage, summarizeMortgage,
} from '../../lib/mortgage';
import { CalcField, CalcSelect, percent, Segmented, StickyTotal, tidy, usd, usdCents } from './fields';
import PaymentDonut from './PaymentDonut';
import './calculators.css';

// Example figures only. They are not a listing, a rate quote, an insurance
// quote or a lender's fee sheet, and the page says so above the form. The
// example puts 5% down because that is the realistic case for most buyers
// and it shows the mortgage insurance line.
export const EXAMPLE_MORTGAGE = {
  price: '450000',
  downPaymentMode: 'percent',
  downPayment: '5',
  loanType: 'conventional',
  program: 'fixed30',
  creditBand: '740',
  ratePct: '6.5',
  laterRatePct: '',
  pointsPct: '0',
  buydown: 'none',
  vaFirstUse: true,
  vaExempt: false,
  financeUpfrontFee: true,
  primaryResidence: true,
  county: 'gwinnett',
  propertyTaxMode: 'percent',
  propertyTax: String(georgiaCounty('gwinnett').ratePct),
  insuranceMode: 'year',
  insurance: '1800',
  hoaMonthly: '0',
  pmiRateMode: 'auto',
  pmiRatePct: '',
  earnestMoney: '5000',
  lenderFees: '1500',
  attorneyTitle: '2500',
  recordingOther: '250',
  appraisalInspection: '1000',
  escrowMonths: '3',
  prepaidInterestDays: '15',
  hoaInitiation: '0',
  sellerCredit: '0',
  annualIncome: '',
  monthlyDebts: '',
  extraMonthly: '',
};

// A link may carry a listing's price, yearly taxes and monthly HOA fee.
export const mortgageFormFromSearch = (search) => {
  const prefill = mortgagePrefillFromSearch(search);
  if (!prefill) return { form: EXAMPLE_MORTGAGE, prefilled: [] };
  const form = { ...EXAMPLE_MORTGAGE, price: String(prefill.price) };
  const prefilled = ['price'];
  if (prefill.taxes !== null) { form.propertyTaxMode = 'amount'; form.propertyTax = String(prefill.taxes); form.county = 'other'; prefilled.push('yearly property taxes'); }
  if (prefill.hoa !== null) { form.hoaMonthly = String(prefill.hoa); prefilled.push('monthly HOA fee'); }
  return { form, prefilled };
};

const listed = (words) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);
const DOLLAR_PERCENT = [{ value: 'amount', label: '$', name: 'Dollars' }, { value: 'percent', label: '%', name: 'Percent of the price' }];
const YEAR_MONTH = [{ value: 'year', label: 'Year', name: 'Per year' }, { value: 'month', label: 'Month', name: 'Per month' }];
const GEORGIA_DREAM = 'https://www.dca.ga.gov/safe-affordable-housing/homeownership/georgia-dream';

const CalcCheck = ({ name, checked, onChange, children }) => (
  <label className="calc-check">
    <input type="checkbox" name={name} checked={checked} onChange={onChange} />
    <span>{children}</span>
  </label>
);

const MortgageSimulator = ({ search = '', hidden = false }) => {
  const prefillKey = useMemo(() => {
    const prefill = mortgagePrefillFromSearch(search);
    return prefill ? [prefill.price, prefill.taxes, prefill.hoa].join('|') : '';
  }, [search]);
  const [{ form, prefilled }, setState] = useState(() => mortgageFormFromSearch(search));
  const setForm = (change) => setState((current) => ({ ...current, form: typeof change === 'function' ? change(current.form) : change }));
  const [view, setView] = useState('year');
  const [shareFigures, setShareFigures] = useState(false);
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
  const type = loanType(form.loanType);
  const price = amount(form.price);

  const update = (event) => {
    const { name, value, type: inputType, checked } = event.target;
    setForm((current) => {
      const next = { ...current, [name]: inputType === 'checkbox' ? checked : value };
      // Choosing an adjustable loan for the first time offers a later rate two
      // points above the starting rate as an example, rather than none.
      if (name === 'program' && loanProgram(value).fixedYears && String(current.laterRatePct).trim() === '') next.laterRatePct = tidy(amount(current.ratePct) + 2, 3);
      // A county sets a starting tax rate; "Other" keeps whatever is typed.
      if (name === 'county') {
        const county = georgiaCounty(value);
        if (county) { next.propertyTaxMode = 'percent'; next.propertyTax = String(county.ratePct); }
      }
      // Typing a tax figure by hand means the county's placeholder no longer applies.
      if (name === 'propertyTax' && current.county !== 'other' && current.county !== '') next.county = 'other';
      return next;
    });
  };

  // Switching the unit keeps the scenario: 5% of $450,000 becomes $22,500.
  const switchUnit = (modeField, valueField, convert) => (mode) => setForm((current) => (current[modeField] === mode
    ? current
    : { ...current, [modeField]: mode, [valueField]: convert(amount(current[valueField]), mode, amount(current.price)) }));
  const dollarsOrPercent = (value, mode, base) => (base <= 0 ? '' : mode === 'amount' ? tidy((base * value) / 100, 0) : tidy((value / base) * 100, 3));
  const yearOrMonth = (value, mode) => (mode === 'month' ? tidy(value / 12, 2) : tidy(value * 12, 2));
  const setPmiMode = (mode) => setForm((current) => ({ ...current, pmiRateMode: mode, pmiRatePct: mode === 'manual' && String(current.pmiRatePct).trim() === '' ? String(result.pmi.ratePct) : current.pmiRatePct }));

  const parts = paymentParts(result);
  const miEnd = result.pmi.endsAfterMonth;
  const showMi = result.pmi.required;
  const fmt = view === 'month' ? usdCents : usd;
  const cash = result.cash;
  const summary = summarizeMortgage(result);
  const preApprovalLink = `/inquire?type=buyer&topic=pre-approval${shareFigures && summary ? `&figures=${encodeURIComponent(summary)}` : ''}`;
  const print = () => { if (typeof window !== 'undefined' && typeof window.print === 'function') window.print(); };

  return (
    <section className="deal-studio-shell calc-shell" aria-label="Buyer mortgage simulator" hidden={hidden}>
      <form className="deal-studio-form" onSubmit={(event) => event.preventDefault()} noValidate>
        {result.valid && <StickyTotal label="Est. monthly payment" value={usd.format(result.monthly.total)} targetRef={resultsRef} />}
        <p className="studio-provider-note calc-intro" role="status">
          <Info />
          {prefilled.length > 0
            ? `The ${listed(prefilled)} came from the link you followed. Check ${prefilled.length > 1 ? 'them' : 'it'} against the listing. The other figures are examples: replace them with your own.`
            : 'The figures below are an example, not a listing, a rate quote or a lender\'s fee sheet. Replace them with your own. Nothing you type here is saved or sent.'}
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
              hint={price > 0 ? `${usd.format(result.downPayment)} down (${percent(result.downPaymentPct)}), so the loan is ${usd.format(result.loanAmount)}${result.upfront.financed ? ` including the financed ${usd.format(result.upfront.amount)} upfront fee` : ''}. Minimum for ${type.label}: ${type.minDownPct}%.` : 'Enter a price first.'}
            />
            <CalcCheck name="primaryResidence" checked={form.primaryResidence} onChange={update}>
              I will live in this home (primary residence). Untick for a second home or an investment property.
            </CalcCheck>
          </div>
        </fieldset>

        <fieldset>
          <legend><span>02</span> Loan</legend>
          <div className="studio-field-grid calc-grid--2">
            <CalcSelect label="Loan type" name="loanType" value={form.loanType} onChange={update} hint={{
              conventional: 'Private mortgage insurance under 20% down, which ends on its own. 3% down for first-time buyers, otherwise 5%.',
              fha: '3.5% down with a 580 score. A 1.75% upfront premium is added to the loan, and the annual premium runs for the life of the loan under 10% down.',
              va: 'For eligible service members, veterans and some surviving spouses. No mortgage insurance; a funding fee is added to the loan unless you are exempt.',
              usda: 'For homes in eligible rural and outer-suburban areas, with income limits. 1% upfront fee added to the loan and a 0.35% annual fee.',
            }[form.loanType]}>
              {LOAN_TYPES.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </CalcSelect>
            <CalcSelect label="Loan term" name="program" value={form.program} onChange={update}>
              {LOAN_PROGRAMS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </CalcSelect>
            <CalcSelect label="Credit score" name="creditBand" value={form.creditBand} onChange={update} hint="Sets the mortgage insurance rate on a conventional loan. Lenders price the interest rate by score too: ask for a quote at your score.">
              {CREDIT_BANDS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </CalcSelect>
            <CalcField
              label={program.fixedYears ? `Interest rate for the first ${program.fixedYears} years` : 'Interest rate'} name="ratePct" value={form.ratePct} onChange={update} suffix="%"
              hint="Example only. Use the rate a lender quotes you, with the points below."
            />
            <CalcField
              label="Discount points" name="pointsPct" value={form.pointsPct} onChange={update} suffix="% of loan"
              hint={`Paid at closing to buy a lower rate${cash.lines.points > 0 ? `: ${usd.format(cash.lines.points)} here` : ''}. Enter the rate the lender quotes with these points.`}
            />
            <CalcSelect label="Temporary buydown" name="buydown" value={form.buydown} onChange={update} hint="Often paid by a seller or builder from their credit. The loan still amortises at the note rate.">
              {BUYDOWNS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </CalcSelect>
            {program.fixedYears && (
              <CalcField
                label={`Rate after year ${program.fixedYears} (your assumption)`} name="laterRatePct" value={form.laterRatePct} onChange={update} suffix="%"
                hint={`Nobody knows this rate today. Your loan's index, margin and caps decide it. The results also show the worst case under ${program.caps.initial}/${program.caps.periodic}/${program.caps.lifetime} caps, the usual ones for this product; your note's caps govern.`}
              />
            )}
            {form.loanType === 'va' && (
              <div className="calc-field-stack">
                <CalcCheck name="vaFirstUse" checked={form.vaFirstUse} onChange={update}>First use of my VA loan benefit</CalcCheck>
                <CalcCheck name="vaExempt" checked={form.vaExempt} onChange={update}>Exempt from the funding fee (service-connected disability rating of 10% or more, certain surviving spouses, Purple Heart recipients)</CalcCheck>
              </div>
            )}
            {result.upfront.pct > 0 && (
              <CalcCheck name="financeUpfrontFee" checked={form.financeUpfrontFee} onChange={update}>
                Add the {percent(result.upfront.pct)} upfront fee ({usd.format(result.upfront.amount)}) to the loan instead of paying it at closing
              </CalcCheck>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend><span>03</span> Taxes, insurance and fees</legend>
          <div className="studio-field-grid calc-grid--2">
            <CalcSelect label="County" name="county" value={form.county} onChange={update} hint="Sets a starting tax rate from 2023 county medians, which reflect owners with homestead exemptions. Exemptions do not transfer: a buyer's first bill is often higher, and homestead must be filed with the county by April 1.">
              {GEORGIA_COUNTIES.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
              <option value="other">Other / I have the tax figure</option>
            </CalcSelect>
            <CalcField
              label="Annual property taxes" name="propertyTax" value={form.propertyTax} onChange={update}
              prefix={form.propertyTaxMode === 'amount' ? '$' : undefined}
              units={DOLLAR_PERCENT} unit={form.propertyTaxMode} unitsLabel="Property taxes entered as"
              onUnitChange={switchUnit('propertyTaxMode', 'propertyTax', dollarsOrPercent)}
              hint={form.propertyTaxMode === 'percent'
                ? `${usd.format(result.annualTax)} a year. ${result.county ? `${result.county.label}'s ${percent(result.county.ratePct)} is a county median, not this home's bill` : `${percent(amount(form.propertyTax) || DEFAULT_PROPERTY_TAX_RATE)} is a placeholder, not a county's rate`}. The listing's figure is often the seller's bill with their exemptions.`
                : `${usd.format(result.monthly.propertyTax)} a month. If this is the seller's bill it may carry their homestead or senior exemption.`}
            />
            <CalcField
              label="Homeowners insurance" name="insurance" value={form.insurance} onChange={update} prefix="$"
              units={YEAR_MONTH} unit={form.insuranceMode} unitsLabel="Insurance entered per"
              onUnitChange={switchUnit('insuranceMode', 'insurance', yearOrMonth)}
              hint="Example only. Ask an insurer for a quote on the home; a flood zone adds a separate policy."
            />
            <CalcField label="HOA / condo fees" name="hoaMonthly" value={form.hoaMonthly} onChange={update} prefix="$" suffix="/ month" hint="From the listing, if the home has an association." />
            {showMi && result.pmi.mode !== 'fha' && result.pmi.mode !== 'usda' ? (
              <CalcField
                label="Mortgage insurance (PMI) rate" name="pmiRatePct" value={form.pmiRateMode === 'manual' ? form.pmiRatePct : String(result.pmi.ratePct)} onChange={update} suffix="% of loan / year"
                readOnly={form.pmiRateMode !== 'manual'}
                units={[{ value: 'auto', label: 'Card', name: 'From the rate card' }, { value: 'manual', label: 'Mine', name: 'My own PMI rate' }]} unit={form.pmiRateMode} unitsLabel="PMI rate taken from"
                onUnitChange={setPmiMode}
                hint={`${usdCents.format(result.pmi.monthly)} a month${form.pmiRateMode === 'manual' ? '.' : ` from a representative rate card at ${CREDIT_BANDS.find((band) => band.key === form.creditBand).label} and ${percent(Math.round(result.loanToValue * 1000) / 10)} loan-to-value. Your insurer's card governs.`}`}
              />
            ) : (
              <p className="calc-quiet-note"><Info /> {showMi
                ? `${result.pmi.name}: ${percent(result.pmi.ratePct)} of the balance a year, ${usdCents.format(result.pmi.monthly)} in the first month, ${result.pmi.lifeOfLoan ? 'for the life of the loan' : `for ${Math.round(miEnd / 12)} years`}.`
                : `No mortgage insurance: ${result.loanAmount > 0 ? (type.key === 'va' ? 'VA loans carry none.' : 'the down payment is 20% or more.') : 'there is no loan.'}`}
              </p>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend><span>04</span> Cash to close</legend>
          <div className="studio-field-grid calc-grid--2">
            <CalcField label="Earnest money" name="earnestMoney" value={form.earnestMoney} onChange={update} prefix="$" hint="Paid when the contract is signed and credited back at closing. Often around 1% of the price in metro Atlanta; the contract sets it." />
            <CalcField label="Appraisal, inspections and application fees" name="appraisalInspection" value={form.appraisalInspection} onChange={update} prefix="$" hint="Paid before closing, usually not credited back." />
            <CalcField label="Lender fees" name="lenderFees" value={form.lenderFees} onChange={update} prefix="$" hint="Origination, underwriting, processing, credit report. Your Loan Estimate, section A and B." />
            <CalcField label="Attorney, title and settlement" name="attorneyTitle" value={form.attorneyTitle} onChange={update} prefix="$" hint="Georgia closes at a closing attorney's office: attorney fee, lender's title policy, an owner's policy if you take one, and the survey." />
            <CalcField label="Recording and other fees" name="recordingOther" value={form.recordingOther} onChange={update} prefix="$" hint={`Recording the deed and security deed, courier, and the rest. Georgia's intangible tax on the loan, ${usd.format(cash.lines.intangibleTax)}, is added for you. Transfer tax is customarily the seller's.`} />
            <CalcField label="HOA initiation or capital contribution" name="hoaInitiation" value={form.hoaInitiation} onChange={update} prefix="$" hint="Many metro Atlanta associations charge one at closing; the covenants say." />
            <CalcField label="Escrow reserve" name="escrowMonths" value={form.escrowMonths} onChange={update} suffix="months" hint={`Taxes and insurance the lender collects up front to start your escrow account: ${usd.format(cash.lines.escrowReserve)}. Two to three months is usual.`} />
            <CalcField label="Days of prepaid interest" name="prepaidInterestDays" value={form.prepaidInterestDays} onChange={update} suffix="days" hint={`Interest from the closing day to the end of that month: ${usd.format(cash.lines.prepaidInterest)}. Closing late in the month means fewer days.`} />
            <CalcField label="Seller credit toward your costs" name="sellerCredit" value={form.sellerCredit} onChange={update} prefix="$" hint={`Negotiated in the contract. On a ${type.label} loan with this down payment a seller may pay up to ${percent(cash.concessionCapPct)} of the price (${usd.format(cash.concessionCap)}), and only toward closing costs and prepaids.`} />
          </div>
        </fieldset>

        <fieldset>
          <legend><span>05</span> Can I afford it? (optional)</legend>
          <div className="studio-field-grid calc-grid--2">
            <CalcField label="Household income before tax" name="annualIncome" value={form.annualIncome} onChange={update} prefix="$" suffix="/ year" hint="Everyone who will be on the loan. Used only here, in your browser." />
            <CalcField label="Other monthly debt payments" name="monthlyDebts" value={form.monthlyDebts} onChange={update} prefix="$" suffix="/ month" hint="Car loans, student loans, minimum card payments, child support. Not utilities or groceries." />
            {!program.fixedYears && <CalcField label="Extra principal each month" name="extraMonthly" value={form.extraMonthly} onChange={update} prefix="$" suffix="/ month" hint="Optional. Shows how much sooner the loan ends and what interest it saves." />}
          </div>
        </fieldset>
      </form>

      <aside className="deal-studio-results calc-results" aria-label="Monthly payment estimate" ref={resultsRef} tabIndex={-1}>
        <div className="deal-studio-results__head"><span><Home /> MONTHLY PAYMENT ESTIMATE</span><small>{result.version}</small></div>
        {!result.valid ? (
          <div className="studio-empty"><Home /><h2>Enter a purchase price</h2><p>The payment, its parts, the cash to close and the loan schedule appear here as you type.</p></div>
        ) : (
          <>
            <div className="calc-hero" aria-live="polite">
              <span>TOTAL ESTIMATED MONTHLY PAYMENT</span>
              <strong>{usd.format(result.monthly.total)}</strong>
              <p>
                {type.label} {program.label.toLowerCase()}{result.loanAmount > 0 ? ` at ${percent(result.rate)}` : ''} on a {usd.format(result.loanAmount)} loan
                {result.adjustable ? `, for the first ${result.adjustable.fixedYears} years` : ''}.
                {result.buydown ? ' The buydown years are below.' : ''}
              </p>
            </div>

            {result.buydown && (
              <div className="calc-callout" role="note">
                <AlertCircle />
                <p>
                  <strong>With the {result.buydown.key} buydown:</strong> {result.buydown.years.map((year) => `${usd.format(year.total)} a month in year ${year.year} at ${percent(year.rate)}`).join(', ')}, then {usd.format(result.monthly.total)}.
                  {' '}The buydown costs {usd.format(result.buydown.cost)}, usually paid from the seller's credit; if the seller is not paying it, add it to your closing costs.
                </p>
              </div>
            )}

            {result.adjustable && (
              <div className="calc-callout" role="note">
                <AlertCircle />
                <p>
                  <strong>After year {result.adjustable.fixedYears}: {usd.format(result.adjustable.totalAfter)} a month</strong> if the rate moves to {percent(result.adjustable.laterRate)},
                  the figure you entered. Principal and interest go from {usd.format(result.monthly.principalInterest)} to {usd.format(result.adjustable.principalInterestAfter)}.
                  {' '}<strong>Worst case under {result.adjustable.caps.initial}/{result.adjustable.caps.periodic}/{result.adjustable.caps.lifetime} caps: {usd.format(result.adjustable.worstCase.total)} a month</strong> at {percent(result.adjustable.worstCase.rate)} from year {result.adjustable.worstCase.reachedYear}. A lender must show you this figure; make sure the worst case fits.
                </p>
              </div>
            )}

            <PaymentDonut parts={parts} total={result.monthly.total} />

            <dl className="calc-stats">
              <div><dt>Loan amount</dt><dd>{usd.format(result.loanAmount)}{result.upfront.financed && <small>includes {usd.format(result.upfront.amount)} upfront fee</small>}</dd></div>
              <div><dt>Down payment</dt><dd>{usd.format(result.downPayment)} <small>{percent(result.downPaymentPct)}</small></dd></div>
              <div><dt>Interest over the loan</dt><dd>{usd.format(result.totals.interest)}</dd></div>
              <div>
                <dt>Mortgage insurance</dt>
                <dd>{showMi && miEnd ? <>{usd.format(result.pmi.total)} <small>{result.pmi.lifeOfLoan ? 'for the life of the loan' : `ends after month ${miEnd} (year ${Math.ceil(miEnd / 12)})`}</small></> : 'None'}</dd>
              </div>
            </dl>

            {result.notes.length > 0 && <ul className="calc-notes">{result.notes.map((note) => <li key={note}>{note}</li>)}</ul>}

            <section className="calc-block" aria-label="Cash to close">
              <h3><Wallet /> Cash to close</h3>
              <table className="calc-table calc-table--items">
                <tbody>
                  <tr><th scope="row">Down payment</th><td>{usd.format(cash.downPayment)}</td></tr>
                  <tr className="calc-table__group"><th scope="row" colSpan={2}>Closing costs</th></tr>
                  <tr><th scope="row">Lender fees</th><td>{usd.format(cash.lines.lenderFees)}</td></tr>
                  {cash.lines.points > 0 && <tr><th scope="row">Discount points ({percent(cash.lines.pointsPct)})</th><td>{usd.format(cash.lines.points)}</td></tr>}
                  <tr><th scope="row">Attorney, title and settlement</th><td>{usd.format(cash.lines.attorneyTitle)}</td></tr>
                  <tr><th scope="row">Georgia intangible tax on the loan</th><td>{usd.format(cash.lines.intangibleTax)}</td></tr>
                  <tr><th scope="row">Recording and other fees</th><td>{usd.format(cash.lines.recordingOther)}</td></tr>
                  {cash.lines.hoaInitiation > 0 && <tr><th scope="row">HOA initiation</th><td>{usd.format(cash.lines.hoaInitiation)}</td></tr>}
                  {cash.lines.upfrontAtClosing > 0 && <tr><th scope="row">Upfront fee paid at closing</th><td>{usd.format(cash.lines.upfrontAtClosing)}</td></tr>}
                  <tr className="calc-table__group"><th scope="row" colSpan={2}>Prepaids</th></tr>
                  <tr><th scope="row">First year of homeowners insurance</th><td>{usd.format(cash.lines.firstYearInsurance)}</td></tr>
                  <tr><th scope="row">Escrow reserve ({cash.lines.escrowMonths} months)</th><td>{usd.format(cash.lines.escrowReserve)}</td></tr>
                  <tr><th scope="row">Prepaid interest ({cash.lines.prepaidInterestDays} days)</th><td>{usd.format(cash.lines.prepaidInterest)}</td></tr>
                  {cash.sellerCredit > 0 && <tr><th scope="row">Less seller credit</th><td>−{usd.format(cash.sellerCredit)}</td></tr>}
                  {cash.earnestMoney > 0 && <tr><th scope="row">Less earnest money already paid</th><td>−{usd.format(cash.earnestMoney)}</td></tr>}
                </tbody>
                <tfoot>
                  <tr className="calc-table__net"><th scope="row">Due at closing</th><td>{usd.format(cash.dueAtClosing)}</td></tr>
                  <tr><th scope="row">Total cash needed, including earnest money and fees paid earlier</th><td>{usd.format(cash.totalNeeded)}</td></tr>
                </tfoot>
              </table>
              <p className="calc-footnote">
                Closing costs and prepaids here are the figures you entered plus Georgia's intangible tax. A lender's Loan Estimate, due within three business days of your application, states them.
                First-time buyers may qualify for down payment help through <a href={GEORGIA_DREAM} target="_blank" rel="noopener noreferrer">Georgia Dream</a> (Georgia Department of Community Affairs); income and price limits apply.
              </p>
            </section>

            {result.affordability && (
              <section className="calc-block" aria-label="Affordability">
                <h3>Can you afford it?</h3>
                <dl className="calc-stats">
                  <div><dt>Housing payment to income</dt><dd>{percent(Math.round(result.affordability.frontPct * 10) / 10)}{result.affordability.limits.front && <small>{type.label} usual ceiling {percent(result.affordability.limits.front)}</small>}</dd></div>
                  <div><dt>All debts to income</dt><dd>{percent(Math.round(result.affordability.backPct * 10) / 10)}<small>{type.label} usual ceiling {percent(result.affordability.limits.back)}</small></dd></div>
                  <div><dt>Verdict</dt><dd>{result.affordability.withinLimits ? 'Within the usual limits' : 'Above the usual limits'}<small>{result.affordability.withinLimits ? 'A lender still checks credit, reserves and the appraisal.' : 'Automated underwriting sometimes allows more, with strong credit and reserves.'}</small></dd></div>
                  <div><dt>Price this income carries</dt><dd>{usd.format(result.affordability.maxPrice)}<small>same down payment, rate, taxes and insurance</small></dd></div>
                </dl>
              </section>
            )}

            {result.extra && (
              <p className="calc-quiet-note calc-quiet-note--block"><Info /> Paying {usd.format(result.extra.monthly)} extra each month ends the loan after {Math.ceil(result.extra.payoffMonth / 12)} years instead of {result.program.years}, {result.extra.monthsSaved} months sooner, and saves about {usd.format(result.extra.interestSaved)} in interest.</p>
            )}

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
                        {showMi && <th scope="col">{result.pmi.mode === 'fha' ? 'MIP' : result.pmi.mode === 'usda' ? 'USDA fee' : 'PMI'}</th>}
                        <th scope="col">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(view === 'year' ? result.years : result.schedule).map((row) => (
                        <tr key={view === 'year' ? row.year : row.month}>
                          <th scope="row">{view === 'year' ? row.year : row.month}</th>
                          <td>{fmt.format(row.principal)}</td>
                          <td>{fmt.format(row.interest)}</td>
                          {showMi && <td>{row.pmi > 0 ? fmt.format(row.pmi) : '—'}</td>}
                          <td>{fmt.format(row.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {showMi && result.pmi.mode !== 'fha' && result.pmi.mode !== 'usda' && <p className="calc-footnote">Mortgage insurance is shown ending when the balance is scheduled to reach 78% of the price, or halfway through the term if that comes first. That is the rule for conventional loans; you can ask the servicer to cancel it at 80%. FHA and other government loans work differently.</p>}
                {result.pmi.mode === 'fha' && <p className="calc-footnote">FHA charges its annual premium on the balance, so it falls a little each year. Under 10% down it runs for the life of the loan; at 10% or more it ends after 11 years. Many FHA borrowers refinance to a conventional loan once they reach 20% equity.</p>}
                {result.pmi.mode === 'usda' && <p className="calc-footnote">USDA's annual fee is charged on the balance for the life of the loan.</p>}
              </section>
            )}

            <div className="calc-cta">
              <Link className="mf-btn mf-btn--solid" to={preApprovalLink}>Get pre-approved <ArrowRight /></Link>
              <Link className="mf-btn" to="/inquire?type=buyer">{prefilled.length > 0 ? 'Contact an agent about this property' : 'Contact an agent about this purchase'}</Link>
              <Link className="mf-btn" to="/search"><Search /> Search Georgia homes</Link>
              <button type="button" className="mf-btn" onClick={print}><Printer /> Print this estimate</button>
            </div>
            <label className="calc-check calc-check--share">
              <input type="checkbox" checked={shareFigures} onChange={(event) => setShareFigures(event.target.checked)} />
              <span>Include my figures in the pre-approval request (price, down payment, loan type, rate, estimated payment and cash to close). Nothing is sent until you send the request.</span>
            </label>
            <p className="calc-footnote">DiamondEcho is not a lender. Pre-approval comes from a lender: send a request and an agent can introduce you to one. {shareFigures ? 'Your figures above will be in the message for you to edit.' : 'The figures above are not sent with it.'}</p>
            <p className="studio-disclaimer">An estimate from the figures above. It is not a loan offer, a rate quote or a commitment to lend, and no lender has reviewed it. A lender's Loan Estimate states the actual payment and costs. Taxes, insurance and association fees change over time. Program rules (minimum down payments, fees, limits) are as published and can change; verify with your lender.</p>
          </>
        )}
      </aside>
    </section>
  );
};

export default MortgageSimulator;
