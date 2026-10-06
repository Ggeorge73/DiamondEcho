import React, { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, Info, Wallet } from 'lucide-react';
import { amount } from '../../lib/mortgage';
import { calculateNetProceeds, georgiaTransferTax } from '../../lib/netProceeds';
import { CalcField, percent, Segmented, StickyTotal, tidy, usd, usdCents } from './fields';
import ProceedsWaterfall from './ProceedsWaterfall';
import './calculators.css';

// Example figures only: not a valuation of anyone's home. The commission boxes
// start empty on purpose. What a brokerage charges is agreed with each seller,
// so the page does not suggest a rate.
export const EXAMPLE_NET_SHEET = {
  salePrice: '450000',
  closingDate: '',
  mortgagePayoff: '250000',
  otherLiens: '',
  listingPct: '',
  buyerPct: '',
  closingMode: 'percent',
  closingCosts: '1.5',
  transferTaxMode: 'georgia',
  transferTax: '',
  recordingFees: '',
  otherCosts: '',
  concessions: '',
  taxMode: 'estimate',
  annualTax: '',
  taxBillPaid: false,
  taxAmount: '',
  hoaDues: '',
};

const DOLLAR_PERCENT = [{ value: 'amount', label: '$', name: 'Dollars' }, { value: 'percent', label: '%', name: 'Percent of the sale price' }];
const GROUP_ORDER = ['Loans and liens', 'Commission', 'Closing', 'Credits to the buyer', 'Prorations', 'Other'];

const SellerNetSheet = ({ hidden = false }) => {
  const [form, setForm] = useState(EXAMPLE_NET_SHEET);
  const result = useMemo(() => calculateNetProceeds(form), [form]);
  const salePrice = amount(form.salePrice);
  const resultsRef = useRef(null);

  const update = (event) => {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }));
  };
  const set = (name) => (value) => setForm((current) => ({ ...current, [name]: value }));

  // Choosing to type the transfer tax starts from Georgia's figure, not from nothing.
  const switchTransferTax = (mode) => setForm((current) => ({
    ...current,
    transferTaxMode: mode,
    transferTax: mode === 'amount' && String(current.transferTax).trim() === '' ? georgiaTransferTax(amount(current.salePrice)).toFixed(2) : current.transferTax,
  }));

  // Switching the unit keeps the figure: 1.5% of $450,000 becomes $6,750.
  const switchClosingUnit = (mode) => setForm((current) => {
    if (current.closingMode === mode) return current;
    const price = amount(current.salePrice);
    const value = amount(current.closingCosts);
    return { ...current, closingMode: mode, closingCosts: price <= 0 ? '' : mode === 'amount' ? tidy((price * value) / 100, 0) : tidy((value / price) * 100, 3) };
  });

  const groups = GROUP_ORDER.map((group) => ({ group, items: result.items.filter((item) => item.group === group) })).filter((entry) => entry.items.length > 0);
  const proration = result.proration;

  return (
    <section className="deal-studio-shell calc-shell" aria-label="Seller net proceeds calculator" hidden={hidden}>
      <form className="deal-studio-form" onSubmit={(event) => event.preventDefault()} noValidate>
        {result.valid && <StickyTotal label={result.shortfall ? 'Est. shortfall' : 'Est. net proceeds'} value={result.shortfall ? `−${usd.format(Math.abs(result.net))}` : usd.format(result.net)} negative={result.shortfall} targetRef={resultsRef} />}
        <p className="studio-provider-note calc-intro" role="status">
          <Info /> The figures below are an example, not a valuation of your home. Replace them with your own. Nothing you type here is saved or sent.
        </p>

        <fieldset>
          <legend><span>01</span> The sale</legend>
          <div className="studio-field-grid calc-grid--2">
            <CalcField label="Estimated sale price" name="salePrice" value={form.salePrice} onChange={update} prefix="$" />
            <CalcField label="Expected closing date (optional)" name="closingDate" value={form.closingDate} onChange={update} type="date" hint="Used only to split the year's property taxes." />
          </div>
        </fieldset>

        <fieldset>
          <legend><span>02</span> Loans and liens to pay off</legend>
          <div className="studio-field-grid calc-grid--2">
            <CalcField label="Remaining mortgage balance" name="mortgagePayoff" value={form.mortgagePayoff} onChange={update} prefix="$" hint="Your lender's payoff letter gives the exact figure, with interest to the closing day." />
            <CalcField label="Other liens" name="otherLiens" value={form.otherLiens} onChange={update} prefix="$" hint="A second mortgage, home equity line, or a tax or contractor lien." />
          </div>
        </fieldset>

        <fieldset>
          <legend><span>03</span> Real estate commission</legend>
          <div className="studio-field-grid calc-grid--3">
            <CalcField label="Listing brokerage" name="listingPct" value={form.listingPct} onChange={update} suffix="%" placeholder="0" />
            <CalcField label="Buyer's brokerage" name="buyerPct" value={form.buyerPct} onChange={update} suffix="%" placeholder="0" />
            <div className="calc-total-box" role="status">
              <span>Total commission</span>
              <strong>{percent(result.commission.totalPct)}</strong>
              <small>{usd.format(result.commission.total)}</small>
            </div>
          </div>
          <p className="calc-quiet-note"><Info /> Commission is negotiable and is not set by law. Enter the rates in your listing agreement. Whether to offer anything toward the buyer's brokerage is the seller's choice.</p>
        </fieldset>

        <fieldset>
          <legend><span>04</span> Closing costs</legend>
          <div className="studio-field-grid calc-grid--2">
            <CalcField
              label="Closing costs, title and attorney fees" name="closingCosts" value={form.closingCosts} onChange={update}
              prefix={form.closingMode === 'amount' ? '$' : undefined}
              units={DOLLAR_PERCENT} unit={form.closingMode} unitsLabel="Closing costs entered as" onUnitChange={switchClosingUnit}
              hint={form.closingMode === 'percent'
                ? `${usd.format(result.items.find((item) => item.key === 'closingCosts')?.amount || 0)}. The percentage is a placeholder; your closing attorney quotes the real figure.`
                : 'Your closing attorney quotes the real figure.'}
            />
            <div className="calc-field-stack">
              <CalcField
                label={form.transferTaxMode === 'georgia' ? 'Georgia transfer tax' : 'Transfer tax'} name="transferTax" prefix="$" onChange={update}
                value={form.transferTaxMode === 'georgia' ? georgiaTransferTax(salePrice).toFixed(2) : form.transferTax} readOnly={form.transferTaxMode === 'georgia'}
                hint={form.transferTaxMode === 'georgia' ? 'State rate, the same in every Georgia county: $1.00 on the first $1,000, then 10 cents per $100. The seller owes it unless the contract says the buyer pays.' : 'Enter the figure for your sale.'}
              />
              <Segmented label="Transfer tax" value={form.transferTaxMode} onChange={switchTransferTax} options={[{ value: 'georgia', label: 'Georgia rate' }, { value: 'amount', label: 'Enter amount' }]} />
            </div>
            <CalcField label="Recording and government fees" name="recordingFees" value={form.recordingFees} onChange={update} prefix="$" placeholder="0" />
            <CalcField label="Other costs" name="otherCosts" value={form.otherCosts} onChange={update} prefix="$" placeholder="0" hint="A home warranty, an association closing letter, a survey." />
          </div>
        </fieldset>

        <fieldset>
          <legend><span>05</span> Credits and prorations</legend>
          <div className="studio-field-grid calc-grid--2">
            <CalcField label="Seller concessions and repair credits" name="concessions" value={form.concessions} onChange={update} prefix="$" placeholder="0" hint="Buyer closing costs you agree to pay, or a credit for repairs." />
            <CalcField label="Outstanding HOA dues" name="hoaDues" value={form.hoaDues} onChange={update} prefix="$" placeholder="0" />
          </div>
          <div className="calc-subsection">
            <div className="calc-subsection__head">
              <h3>Prorated property taxes</h3>
              <Segmented label="Property taxes" value={form.taxMode} onChange={set('taxMode')} options={[{ value: 'estimate', label: 'Estimate' }, { value: 'amount', label: 'Enter amount' }]} />
            </div>
            {form.taxMode === 'estimate' ? (
              <>
                <div className="studio-field-grid calc-grid--2">
                  <CalcField label="This year's property tax bill" name="annualTax" value={form.annualTax} onChange={update} prefix="$" placeholder="0" hint="Last year's bill is the usual stand-in until the new one is issued." />
                  <label className="calc-check"><input type="checkbox" name="taxBillPaid" checked={form.taxBillPaid} onChange={update} /><span>I have already paid this year's bill</span></label>
                </div>
                <p className="calc-quiet-note" role="status">
                  <Info />
                  {!proration.estimated
                    ? (amount(form.annualTax) > 0 ? 'Choose a closing date above to estimate your share.' : 'Enter the yearly bill and a closing date to estimate your share. Georgia counties tax by the calendar year.')
                    : proration.kind === 'credit'
                      ? `You own the home for ${proration.sellerDays} of ${proration.daysInYear} days this year and have paid the whole bill, so the buyer returns ${usdCents.format(proration.amount)} to you.`
                      : `You own the home for ${proration.sellerDays} of ${proration.daysInYear} days this year, so ${usdCents.format(proration.amount)} of the bill is yours and is credited to the buyer.`}
                </p>
              </>
            ) : (
              <div className="studio-field-grid calc-grid--2">
                <CalcField label="Property taxes you owe at closing" name="taxAmount" value={form.taxAmount} onChange={update} prefix="$" placeholder="0" />
              </div>
            )}
          </div>
        </fieldset>
      </form>

      <aside className="deal-studio-results calc-results" aria-label="Net proceeds estimate" ref={resultsRef} tabIndex={-1}>
        <div className="deal-studio-results__head"><span><Wallet /> NET PROCEEDS ESTIMATE</span><small>{result.version}</small></div>
        {!result.valid ? (
          <div className="studio-empty"><Wallet /><h2>Enter a sale price</h2><p>Your estimated proceeds and every deduction appear here as you type.</p></div>
        ) : (
          <>
            <div className={`calc-hero${result.shortfall ? ' calc-hero--shortfall' : ''}`} aria-live="polite">
              <span>{result.shortfall ? 'ESTIMATED SHORTFALL AT CLOSING' : 'ESTIMATED NET PROCEEDS'}</span>
              <strong>{result.shortfall ? `−${usd.format(Math.abs(result.net))}` : usd.format(result.net)}</strong>
              <p>
                {result.shortfall
                  ? `The costs entered are ${usd.format(Math.abs(result.net))} more than the ${usd.format(result.salePrice)} sale price.`
                  : `${percent(result.netPct)} of the ${usd.format(result.salePrice)} sale price, after ${usd.format(result.totalDeductions)} in deductions${result.totalCredits > 0 ? ` and ${usd.format(result.totalCredits)} credited back to you` : ''}.`}
              </p>
            </div>

            {result.notes.length > 0 && (
              <div className="calc-callout" role="note"><AlertCircle /><ul>{result.notes.map((note) => <li key={note}>{note}</li>)}</ul></div>
            )}

            <section className="calc-block" aria-label="From sale price to net proceeds">
              <h3>From sale price to net proceeds</h3>
              <ProceedsWaterfall steps={result.steps} />
            </section>

            <section className="calc-block" aria-label="Itemized deductions">
              <h3>Itemized deductions</h3>
              <table className="calc-table calc-table--items">
                <thead><tr><th scope="col">Line</th><th scope="col">Amount</th><th scope="col">Of price</th></tr></thead>
                {groups.map(({ group, items }) => (
                  <tbody key={group}>
                    <tr className="calc-table__group"><th scope="colgroup" colSpan={3}>{group}</th></tr>
                    {items.map((item) => (
                      <tr key={item.key}>
                        <th scope="row">{item.label}</th>
                        <td>{item.kind === 'credit' ? '+' : '−'}{usdCents.format(item.amount)}</td>
                        <td>{percent((item.amount / result.salePrice) * 100)}</td>
                      </tr>
                    ))}
                  </tbody>
                ))}
                <tfoot>
                  <tr><th scope="row">Sale price</th><td>{usdCents.format(result.salePrice)}</td><td>100%</td></tr>
                  <tr><th scope="row">Total deductions</th><td>−{usdCents.format(result.totalDeductions)}</td><td>{percent((result.totalDeductions / result.salePrice) * 100)}</td></tr>
                  {result.totalCredits > 0 && <tr><th scope="row">Credits to you</th><td>+{usdCents.format(result.totalCredits)}</td><td>{percent((result.totalCredits / result.salePrice) * 100)}</td></tr>}
                  <tr className="calc-table__net"><th scope="row">{result.shortfall ? 'Shortfall at closing' : 'Estimated net proceeds'}</th><td>{result.shortfall ? '−' : ''}{usdCents.format(Math.abs(result.net))}</td><td>{percent(result.netPct)}</td></tr>
                </tfoot>
              </table>
            </section>

            <div className="calc-cta">
              <Link className="mf-btn mf-btn--solid" to="/inquire?type=seller">Request a home valuation <ArrowRight /></Link>
            </div>
            <p className="calc-footnote">A valuation here is an agent's opinion of price from comparable sales. It is not an appraisal.</p>
            <p className="studio-disclaimer">An estimate from the figures above, not a settlement statement. Your closing attorney prepares the final figures, and your lender's payoff letter states the exact payoff. Income tax on a sale is not included; ask a tax professional.</p>
          </>
        )}
      </aside>
    </section>
  );
};

export default SellerNetSheet;
