import React, { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, Info, Printer, Scale, Wallet } from 'lucide-react';
import { amount } from '../../lib/mortgage';
import {
  calculateNetProceeds, compareOffers, georgiaTransferTax, HOA_PERIODS, RECORDING_FEE, RESIDENCY, summarizeNetSheet,
} from '../../lib/netProceeds';
import { CalcField, CalcSelect, percent, Segmented, StickyTotal, tidy, usd, usdCents } from './fields';
import PaymentDonut from './PaymentDonut';
import ProceedsWaterfall from './ProceedsWaterfall';
import './calculators.css';

// Example figures only: not a valuation of anyone's home and not a lender's or
// attorney's figures. The commission boxes start empty on purpose: what a
// brokerage charges is agreed with each seller, so the page suggests no rate
// (Gbenga, 2026-11-09, reversing a same-day idea of quick picks).
export const EXAMPLE_NET_SHEET = {
  salePrice: '450000',
  closingDate: '',
  payoffMode: 'estimate',
  mortgageBalance: '250000',
  mortgageRate: '6.25',
  paidThrough: '',
  payoffCushionDays: '2',
  payoffReleaseFee: '50',
  mortgagePayoff: '',
  secondLien: '',
  otherLiens: '',
  listingPct: '',
  buyerPct: '',
  transferTaxPayer: 'buyer',
  transferTaxMode: 'georgia',
  transferTax: '',
  deedPrep: '150',
  payoffProcessing: '150',
  titleClearance: '',
  mailAway: '',
  homeWarranty: '',
  recordingFees: '',
  otherCosts: '',
  concessions: '',
  repairCredits: '',
  taxMode: 'estimate',
  annualTax: '',
  taxBillPaid: false,
  taxAmount: '',
  hoaDues: '',
  hoaPeriod: 'month',
  hoaPaid: true,
  hoaPastDue: '',
  hoaLetterFee: '',
  hoaLetterPayer: 'seller',
  hoaTransferFee: '',
  hoaTransferPayer: 'buyer',
  sellerResidency: 'georgia',
  principalResidence: true,
  buyerWillOccupy: true,
  gaWithholdingMode: 'price',
  gainAmount: '',
  // Offer B, for the comparison.
  compare: false,
  offerPrice: '',
  offerConcessions: '',
  offerBuyerPct: '',
  offerClosingDate: '',
};

const DOLLAR_PERCENT = [{ value: 'amount', label: '$', name: 'Dollars' }, { value: 'percent', label: '%', name: 'Percent of the sale price' }];
const BUYER_SELLER = [{ value: 'buyer', label: 'Buyer' }, { value: 'seller', label: 'Seller' }];
const GROUP_ORDER = ['Loans and liens', 'Commission', 'Closing', 'Credits to the buyer', 'Prorations', 'Withholding'];
const RING_LABELS = { subject: 'Sale price', center: 'sale price', caption: 'Where the sale price goes', part: 'Goes to', value: 'Amount' };

const CalcCheck = ({ name, checked, onChange, children }) => (
  <label className="calc-check">
    <input type="checkbox" name={name} checked={checked} onChange={onChange} />
    <span>{children}</span>
  </label>
);

const SellerNetSheet = ({ hidden = false }) => {
  const [form, setForm] = useState(EXAMPLE_NET_SHEET);
  const [shareFigures, setShareFigures] = useState(false);
  const result = useMemo(() => calculateNetProceeds(form), [form]);
  const comparison = useMemo(() => (form.compare && amount(form.offerPrice) > 0
    ? compareOffers(form, { salePrice: form.offerPrice, concessions: form.offerConcessions, buyerPct: form.offerBuyerPct || form.buyerPct, closingDate: form.offerClosingDate })
    : null), [form]);
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
  // Switching to the lender's letter starts from the estimate, so the figure is not lost.
  const switchPayoff = (mode) => setForm((current) => ({
    ...current,
    payoffMode: mode,
    mortgagePayoff: mode === 'letter' && String(current.mortgagePayoff).trim() === '' ? tidy(result.payoff.total, 2) : current.mortgagePayoff,
  }));

  const groups = GROUP_ORDER.map((group) => ({ group, items: result.items.filter((item) => item.group === group) })).filter((entry) => entry.items.length > 0);
  const proration = result.proration;
  const dues = result.dues;
  const payoff = result.payoff;
  const summary = summarizeNetSheet(result);
  const valuationLink = `/inquire?type=seller&topic=net-sheet${shareFigures && summary ? `&figures=${encodeURIComponent(summary)}` : ''}`;
  const print = () => { if (typeof window !== 'undefined' && typeof window.print === 'function') window.print(); };

  return (
    <section className="deal-studio-shell calc-shell" aria-label="Seller net proceeds calculator" hidden={hidden}>
      <form className="deal-studio-form" onSubmit={(event) => event.preventDefault()} noValidate>
        {result.valid && <StickyTotal label={result.shortfall ? 'Est. shortfall' : 'Est. net proceeds'} value={result.shortfall ? `−${usd.format(Math.abs(result.net))}` : usd.format(result.net)} negative={result.shortfall} targetRef={resultsRef} />}
        <p className="studio-provider-note calc-intro" role="status">
          <Info /> The figures below are an example, not a valuation of your home or a settlement statement. Replace them with your own. Nothing you type here is saved or sent.
        </p>

        <fieldset>
          <legend><span>01</span> The sale</legend>
          <div className="studio-field-grid calc-grid--2">
            <CalcField label="Estimated sale price" name="salePrice" value={form.salePrice} onChange={update} prefix="$" />
            <CalcField label="Expected closing date" name="closingDate" value={form.closingDate} onChange={update} type="date" hint="Sets the interest in your payoff and splits the year's taxes and the period's association dues." />
            <CalcSelect label="Where do you live at closing?" name="sellerResidency" value={form.sellerResidency} onChange={update} hint="Georgia withholds 3% from a seller whose principal residence is outside Georgia, and federal FIRPTA applies to a seller who is not a US resident. Each has exemptions; the closing attorney files the affidavits.">
              {RESIDENCY.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </CalcSelect>
            <div className="calc-field-stack">
              <CalcCheck name="principalResidence" checked={form.principalResidence} onChange={update}>This home is (or was) my principal residence</CalcCheck>
              {form.sellerResidency === 'foreign' && <CalcCheck name="buyerWillOccupy" checked={form.buyerWillOccupy} onChange={update}>The buyer will live in the home (lowers FIRPTA at $1,000,000 or less)</CalcCheck>}
            </div>
            {form.sellerResidency !== 'georgia' && !form.principalResidence && (
              <>
                <div className="calc-field-stack">
                  <Segmented label="Georgia withholding based on" value={form.gaWithholdingMode} onChange={set('gaWithholdingMode')} options={[{ value: 'price', label: 'Sale price' }, { value: 'gain', label: 'My gain (affidavit)' }]} />
                </div>
                {form.gaWithholdingMode === 'gain' && <CalcField label="Gain on the sale" name="gainAmount" value={form.gainAmount} onChange={update} prefix="$" hint="Price less what you paid and improvements, as you will swear on form IT-AFF2. Ask a CPA for the figure." />}
              </>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend><span>02</span> Loans and liens to pay off</legend>
          <div className="studio-field-grid calc-grid--2">
            <div className="calc-field-stack">
              <Segmented label="Mortgage payoff" value={form.payoffMode} onChange={switchPayoff} options={[{ value: 'estimate', label: 'Estimate it' }, { value: 'letter', label: "From my lender's letter" }]} />
            </div>
            {form.payoffMode === 'estimate' ? (
              <>
                <CalcField label="Mortgage balance" name="mortgageBalance" value={form.mortgageBalance} onChange={update} prefix="$" hint="The principal on your statement. A payoff is more than this: interest runs until the lender is paid." />
                <CalcField label="Interest rate" name="mortgageRate" value={form.mortgageRate} onChange={update} suffix="%" hint={payoff.estimated ? `${usdCents.format(payoff.perDiem)} a day, ${payoff.interestDays} days (to closing plus a ${payoff.cushionDays}-day wire cushion): ${usd.format(payoff.interest)} of interest.` : 'Interest is added once a closing date is chosen.'} />
                <CalcField label="Interest paid through" name="paidThrough" value={form.paidThrough} onChange={update} type="date" hint="Mortgage interest is paid in arrears: a payment on June 1 covers May. Leave blank to assume the first of the closing month." />
                <CalcField label="Release and statement fees" name="payoffReleaseFee" value={form.payoffReleaseFee} onChange={update} prefix="$" hint={`On the payoff letter. Estimated payoff: ${usd.format(payoff.total)}. Your escrow balance is refunded by the lender after closing, not here.`} />
              </>
            ) : (
              <CalcField label="Payoff from the lender's letter" name="mortgagePayoff" value={form.mortgagePayoff} onChange={update} prefix="$" hint="Good through the date on the letter; the attorney orders a fresh one for the closing day." />
            )}
            <CalcField label="Second mortgage or HELOC" name="secondLien" value={form.secondLien} onChange={update} prefix="$" placeholder="0" hint="A line of credit must also be closed in writing, or the lien stays." />
            <CalcField label="Other liens" name="otherLiens" value={form.otherLiens} onChange={update} prefix="$" placeholder="0" hint="A tax, judgment or contractor lien." />
          </div>
        </fieldset>

        <fieldset>
          <legend><span>03</span> Real estate commission</legend>
          <div className="studio-field-grid calc-grid--3">
            <CalcField label="Listing brokerage" name="listingPct" value={form.listingPct} onChange={update} suffix="%" placeholder="0" hint="The rate in your listing agreement." />
            <CalcField label="Buyer's brokerage" name="buyerPct" value={form.buyerPct} onChange={update} suffix="%" placeholder="0" hint="Whatever you agree to in the offer, if anything. It differs offer by offer." />
            <div className="calc-total-box" role="status">
              <span>Total commission</span>
              <strong>{percent(result.commission.totalPct)}</strong>
              <small>{usd.format(result.commission.total)}</small>
            </div>
          </div>
          <p className="calc-quiet-note"><Info /> Commission is negotiable and is not set by law. Enter the rates in your listing agreement. Whether to offer anything toward the buyer's brokerage is your choice.</p>
        </fieldset>

        <fieldset>
          <legend><span>04</span> Closing costs</legend>
          <div className="studio-field-grid calc-grid--2">
            <div className="calc-field-stack">
              <CalcField
                label={form.transferTaxMode === 'georgia' ? 'Georgia transfer tax' : 'Transfer tax'} name="transferTax" prefix="$" onChange={update}
                value={form.transferTaxMode === 'georgia' ? georgiaTransferTax(salePrice).toFixed(2) : form.transferTax} readOnly={form.transferTaxMode === 'georgia'}
                hint={form.transferTaxMode === 'georgia' ? 'State rate, the same in every Georgia county: $1.00 on the first $1,000, then 10 cents per $100.' : 'Enter the figure for your sale.'}
              />
              <Segmented label="Transfer tax" value={form.transferTaxMode} onChange={switchTransferTax} options={[{ value: 'georgia', label: 'Georgia rate' }, { value: 'amount', label: 'Enter amount' }]} />
            </div>
            <div className="calc-field-stack">
              <CalcField label="Deed preparation" name="deedPrep" value={form.deedPrep} onChange={update} prefix="$" readOnly={form.transferTaxPayer === 'buyer'} hint={form.transferTaxPayer === 'buyer' ? 'Paid by the buyer with the transfer tax under the GAR contract, so it is not in your figures.' : 'The attorney\'s charge to prepare the warranty deed.'} />
              <Segmented label="Transfer tax and deed preparation paid by" value={form.transferTaxPayer} onChange={set('transferTaxPayer')} options={BUYER_SELLER} />
              <p className="calc-quiet-note"><Info /> The GAR purchase and sale agreement puts both on the buyer ("Items Paid by Buyer"), although the statute names the seller. Your signed contract decides.</p>
            </div>
            <CalcField label="Payoff processing, wire and courier" name="payoffProcessing" value={form.payoffProcessing} onChange={update} prefix="$" hint={`The attorney's charges to pay off your loan and send documents. Recording each lien cancellation is added for you at $${RECORDING_FEE}.`} />
            <CalcField label="Clearing title" name="titleClearance" value={form.titleClearance} onChange={update} prefix="$" placeholder="0" hint="Yours under the contract: an old unreleased lien, a boundary fix, a missing probate." />
            <CalcField label="Mail-away or power of attorney" name="mailAway" value={form.mailAway} onChange={update} prefix="$" placeholder="0" hint="If you will not be at the closing table." />
            <CalcField label="Home warranty for the buyer" name="homeWarranty" value={form.homeWarranty} onChange={update} prefix="$" placeholder="0" hint="Only if the contract says you provide one." />
            <CalcField label="Recording and government fees" name="recordingFees" value={form.recordingFees} onChange={update} prefix="$" placeholder="0" hint="Anything else the attorney records for you." />
            <CalcField label="Other costs" name="otherCosts" value={form.otherCosts} onChange={update} prefix="$" placeholder="0" hint="A termite letter if the buyer's lender asks for one, a survey, a final utility bill." />
          </div>
          <p className="calc-quiet-note"><Info /> In Georgia the buyer picks and pays the closing attorney, the title search and the title policies. Your own closing costs are mostly these flat items; the attorney's final statement is the only exact figure.</p>
        </fieldset>

        <fieldset>
          <legend><span>05</span> Credits to the buyer</legend>
          <div className="studio-field-grid calc-grid--2">
            <CalcField label="Contribution to the buyer's closing costs" name="concessions" value={form.concessions} onChange={update} prefix="$" placeholder="0" hint="The dollar figure in the contract. The buyer's loan caps it: 3% to 9% of price on a conventional loan by down payment, 6% FHA and USDA, 4% VA." />
            <CalcField label="Repair credits" name="repairCredits" value={form.repairCredits} onChange={update} prefix="$" placeholder="0" hint="Agreed after inspection instead of making the repairs. A VA buyer cannot pay some fees, so they can land here too." />
          </div>
        </fieldset>

        <fieldset>
          <legend><span>06</span> Prorations and association</legend>
          <div className="calc-subsection">
            <div className="calc-subsection__head">
              <h3>Prorated property taxes</h3>
              <Segmented label="Property taxes" value={form.taxMode} onChange={set('taxMode')} options={[{ value: 'estimate', label: 'Estimate' }, { value: 'amount', label: 'Enter amount' }]} />
            </div>
            {form.taxMode === 'estimate' ? (
              <>
                <div className="studio-field-grid calc-grid--2">
                  <CalcField label="This year's property tax bill" name="annualTax" value={form.annualTax} onChange={update} prefix="$" placeholder="0" hint="Most metro counties bill in late summer, due mid-October to mid-November. Before the bill is out, last year's stands in and the contract trues it up when the real one arrives." />
                  <label className="calc-check"><input type="checkbox" name="taxBillPaid" checked={form.taxBillPaid} onChange={update} /><span>I have already paid this year's bill</span></label>
                </div>
                <p className="calc-quiet-note" role="status">
                  <Info />
                  {!proration.estimated
                    ? (amount(form.annualTax) > 0 ? 'Choose a closing date above to estimate your share.' : 'Enter the yearly bill and a closing date to estimate your share. Georgia counties tax by the calendar year; your bill includes your homestead exemption, which does not pass to the buyer.')
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
          <div className="calc-subsection">
            <div className="calc-subsection__head"><h3>Homeowners or condo association</h3></div>
            <div className="studio-field-grid calc-grid--2">
              <div className="calc-field-stack">
                <CalcField label="Association dues" name="hoaDues" value={form.hoaDues} onChange={update} prefix="$" placeholder="0" />
                <Segmented label="Dues are charged" value={form.hoaPeriod} onChange={set('hoaPeriod')} options={HOA_PERIODS.map((option) => ({ value: option.key, label: option.label }))} />
              </div>
              <CalcCheck name="hoaPaid" checked={form.hoaPaid} onChange={update}>I have paid the dues for the period that includes the closing</CalcCheck>
              <CalcField label="Unpaid dues, late charges and special assessments" name="hoaPastDue" value={form.hoaPastDue} onChange={update} prefix="$" placeholder="0" hint="Anything levied before closing is yours unless the contract says otherwise." />
              <div className="calc-field-stack">
                <CalcField label="Association closing letter" name="hoaLetterFee" value={form.hoaLetterFee} onChange={update} prefix="$" placeholder="0" hint="The management company's statement of account and transfer package, often $150–400. The attorney orders it." />
                <Segmented label="Closing letter paid by" value={form.hoaLetterPayer} onChange={set('hoaLetterPayer')} options={BUYER_SELLER} />
              </div>
              <div className="calc-field-stack">
                <CalcField label="Transfer, initiation or capital contribution fee" name="hoaTransferFee" value={form.hoaTransferFee} onChange={update} prefix="$" placeholder="0" hint="The covenants say who pays; under the GAR contract it falls to the buyer unless agreed otherwise." />
                <Segmented label="Transfer fee paid by" value={form.hoaTransferPayer} onChange={set('hoaTransferPayer')} options={BUYER_SELLER} />
              </div>
            </div>
            {amount(form.hoaDues) > 0 && (
              <p className="calc-quiet-note" role="status">
                <Info />
                {!dues.estimated
                  ? 'Choose a closing date above to prorate the dues.'
                  : dues.kind === 'credit'
                    ? `You own the home for ${dues.sellerDays} of the ${dues.periodDays} days in this period and have paid it, so the buyer returns ${usdCents.format(dues.amount)} to you.`
                    : `You own the home for ${dues.sellerDays} of the ${dues.periodDays} days in this period, so ${usdCents.format(dues.amount)} of the dues is yours.`}
              </p>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend><span>07</span> Compare an offer (optional)</legend>
          <div className="studio-field-grid calc-grid--2">
            <CalcCheck name="compare" checked={form.compare} onChange={update}>Show a second offer beside this one, with the same costs</CalcCheck>
            {form.compare && (
              <>
                <CalcField label="Offer B price" name="offerPrice" value={form.offerPrice} onChange={update} prefix="$" />
                <CalcField label="Offer B contribution to buyer's costs" name="offerConcessions" value={form.offerConcessions} onChange={update} prefix="$" placeholder="0" />
                <CalcField label="Offer B buyer's brokerage" name="offerBuyerPct" value={form.offerBuyerPct} onChange={update} suffix="%" placeholder={form.buyerPct || '0'} hint="Blank uses the rate above." />
                <CalcField label="Offer B closing date" name="offerClosingDate" value={form.offerClosingDate} onChange={update} type="date" hint="Blank uses the date above. A later close means more payoff interest and more tax days." />
              </>
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

            <PaymentDonut parts={result.shares} total={result.salePrice + result.totalCredits} labels={RING_LABELS} />

            {comparison && (
              <section className="calc-block" aria-label="Offer comparison">
                <h3><Scale /> Offer A against offer B</h3>
                <table className="calc-table calc-table--items">
                  <thead><tr><th scope="col">Line</th><th scope="col">Offer A</th><th scope="col">Offer B</th></tr></thead>
                  <tbody>
                    <tr><th scope="row">Sale price</th><td>{usd.format(comparison.a.salePrice)}</td><td>{usd.format(comparison.b.salePrice)}</td></tr>
                    <tr><th scope="row">Contribution to buyer's costs</th><td>−{usd.format(comparison.a.items.find((item) => item.key === 'concessions')?.amount || 0)}</td><td>−{usd.format(comparison.b.items.find((item) => item.key === 'concessions')?.amount || 0)}</td></tr>
                    <tr><th scope="row">Commission</th><td>−{usd.format(comparison.a.commission.total)}</td><td>−{usd.format(comparison.b.commission.total)}</td></tr>
                    <tr><th scope="row">Mortgage payoff</th><td>−{usd.format(comparison.a.payoff.total)}</td><td>−{usd.format(comparison.b.payoff.total)}</td></tr>
                    <tr><th scope="row">All other deductions and credits</th><td>−{usd.format(comparison.a.totalDeductions - comparison.a.commission.total - comparison.a.payoff.total - (comparison.a.items.find((item) => item.key === 'concessions')?.amount || 0) - comparison.a.totalCredits)}</td><td>−{usd.format(comparison.b.totalDeductions - comparison.b.commission.total - comparison.b.payoff.total - (comparison.b.items.find((item) => item.key === 'concessions')?.amount || 0) - comparison.b.totalCredits)}</td></tr>
                  </tbody>
                  <tfoot>
                    <tr className="calc-table__net"><th scope="row">Estimated net</th><td>{usd.format(comparison.a.net)}</td><td>{usd.format(comparison.b.net)}</td></tr>
                    <tr><th scope="row">Difference</th><td colSpan={2}>Offer B nets {comparison.difference >= 0 ? usd.format(comparison.difference) + ' more' : usd.format(Math.abs(comparison.difference)) + ' less'} than offer A.</td></tr>
                  </tfoot>
                </table>
                <p className="calc-footnote">Sellers decide on net, not on price. Terms the sheet cannot price (financing strength, appraisal gap, contingencies, possession) still matter.</p>
              </section>
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
              <p className="calc-footnote">What the attorney will ask you for: the payoff letter for every loan, the association's closing letter, your residency affidavit (IT-AFF1 or IT-AFF2) if you live outside Georgia, a government ID, and your wire instructions confirmed by phone. Income tax on the sale is not on the statement: up to $250,000 of gain ($500,000 for a couple) can be excluded on a home you lived in for two of the last five years. Ask a tax professional.</p>
            </section>

            <div className="calc-cta">
              <Link className="mf-btn mf-btn--solid" to={valuationLink}>Request a home valuation <ArrowRight /></Link>
              <button type="button" className="mf-btn" onClick={print}><Printer /> Print this estimate</button>
            </div>
            <label className="calc-check calc-check--share">
              <input type="checkbox" checked={shareFigures} onChange={(event) => setShareFigures(event.target.checked)} />
              <span>Include my figures in the valuation request (price, closing date, payoff, commission, deductions and estimated net). Nothing is sent until you send the request.</span>
            </label>
            <p className="calc-footnote">A valuation here is an agent's opinion of price from comparable sales. It is not an appraisal. {shareFigures ? 'Your figures above will be in the message for you to edit.' : 'The figures above are not sent with it.'}</p>
            <p className="studio-disclaimer">An estimate from the figures above, not a settlement statement. Your closing attorney prepares the final figures, your lender's payoff letter states the exact payoff, and your signed contract decides who pays each line. Program caps, tax rules and fees are as published and can change. Income tax on a sale is not included; ask a tax professional.</p>
          </>
        )}
      </aside>
    </section>
  );
};

export default SellerNetSheet;
