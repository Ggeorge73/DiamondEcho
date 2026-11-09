import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import SellerNetSheet from './SellerNetSheet';
import { waterfallLayout } from './ProceedsWaterfall';
import { helpers } from './testHelpers';

let container;
let root;
const { text, field, type, press, group } = helpers(() => container);
const hero = () => container.querySelector('.calc-hero strong').textContent;
const waterfall = () => [...container.querySelectorAll('.calc-waterfall__row')];
const itemRows = () => [...container.querySelectorAll('[aria-label="Itemized deductions"] tbody tr:not(.calc-table__group)')].map((row) => row.textContent);
const legendRows = () => [...container.querySelectorAll('.calc-legend tbody tr')].map((row) => row.textContent);
const check = async (name, checked) => {
  const control = field(name);
  await act(async () => { if (control.checked !== checked) control.click(); });
};

beforeEach(async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><SellerNetSheet /></MemoryRouter>); });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

// The example with no closing date: $450,000 less the $250,000 balance plus
// the $50 release fee (no interest until a date is chosen), $150 payoff
// processing and $25 to record the cancellation. Transfer tax is the buyer's.
test('opens on a labelled example, with transfer tax on the buyer and no commission suggested', async () => {
  expect(text()).toContain('The figures below are an example, not a valuation of your home or a settlement statement.');
  expect(field('listingPct').value).toBe('');
  expect(field('buyerPct').value).toBe('');
  expect(text()).toContain('Commission is negotiable and is not set by law.');
  expect(text()).toContain('No commission is entered.');
  expect(text()).toContain('diamond-net-sheet-2.0.0');
  expect(hero()).toBe('$199,775');
  expect(itemRows()).toEqual(['Mortgage payoff (estimated)−$250,050.0055.57%', 'Payoff processing, wire and courier−$150.000.03%', 'Recording the lien cancellation−$25.000.01%']);
  expect(text()).toContain('Georgia transfer tax and deed preparation are shown as the buyer\'s, the GAR contract default.');
});

test('the listing rate has quick picks and a typed figure; the buyer\'s rate is typed', async () => {
  const picks = group('Listing rate');
  expect([...picks.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['2.5%', '2.75%', '3%', 'Other']);
  await press('2.75%', picks);
  expect(field('listingPct').value).toBe('2.75');
  expect(itemRows()).toContain('Listing brokerage commission−$12,375.002.75%');
  await type('listingPct', '3.2');
  expect(picks.querySelector('[aria-pressed="true"]').textContent).toBe('Other');
  await press('3%', picks);
  await type('buyerPct', '2.5');
  expect(container.querySelector('.calc-total-box').textContent).toBe('Total commission5.5%$24,750');
  expect(hero()).toBe('$175,025');
  expect(text()).toContain('The quick picks are common rates, not a price list');
});

test('the payoff adds interest to the closing day once a date is chosen, or takes the lender\'s letter', async () => {
  expect(text()).toContain('balance alone until a closing date');
  await type('closingDate', '2026-06-15');
  expect(text()).toContain('$42.81 a day, 16 days (to closing plus a 2-day wire cushion): $685 of interest.');
  expect(text()).toContain('Estimated payoff: $250,735.');
  expect(itemRows()[0]).toBe('Mortgage payoff (estimated)−$250,734.9655.72%');
  await type('paidThrough', '2026-05-01');
  expect(text()).toContain('47 days');
  expect(text()).toContain('Your escrow balance is refunded by the lender after closing');
  await press("From my lender's letter", group('Mortgage payoff'));
  expect(field('mortgageBalance')).toBeNull();
  // 250,000 + 47 days × $42.81 + $50.
  expect(field('mortgagePayoff').value).toBe('252062.07');
  await type('mortgagePayoff', '251000');
  expect(itemRows()[0]).toBe('Mortgage payoff−$251,000.0055.78%');
});

test('Georgia transfer tax is the buyer\'s by default and moves to the seller with its deed preparation', async () => {
  expect(field('transferTax').value).toBe('450.00');
  expect(field('transferTax').readOnly).toBe(true);
  expect(field('deedPrep').readOnly).toBe(true);
  expect(itemRows().some((row) => row.includes('transfer tax'))).toBe(false);
  await press('Seller', group('Transfer tax and deed preparation paid by'));
  expect(itemRows()).toContain('Georgia transfer tax−$450.000.1%');
  expect(itemRows()).toContain('Deed preparation−$150.000.03%');
  expect(hero()).toBe('$199,175');
  expect(text()).not.toContain('shown as the buyer\'s');
  await type('salePrice', '612350');
  expect(field('transferTax').value).toBe('612.40');
  await press('Enter amount', group('Transfer tax'));
  expect(field('transferTax').value).toBe('612.40');
  await type('transferTax', '700');
  expect(itemRows().some((row) => row.startsWith('Transfer tax−$700.00'))).toBe(true);
});

test('property taxes are prorated from the yearly bill and the closing date, both ways', async () => {
  await type('annualTax', '5400');
  expect(text()).toContain('Choose a closing date above to estimate your share.');
  await type('closingDate', '2026-06-15');
  expect(text()).toContain('You own the home for 165 of 365 days this year, so $2,441.10 of the bill is yours and is credited to the buyer.');
  expect(itemRows()).toContain('Prorated property taxes−$2,441.100.54%');
  await check('taxBillPaid', true);
  expect(text()).toContain('so the buyer returns $2,958.90 to you.');
  expect(itemRows()).toContain('Property tax refunded by the buyer+$2,958.900.66%');
  expect(text()).toContain('Credits to you');
  expect(waterfall().find((row) => row.textContent.includes('Property tax refunded')).className).toContain('calc-waterfall__row--credit');
  await press('Enter amount', group('Property taxes'));
  expect(field('annualTax')).toBeNull();
  await type('taxAmount', '1800');
  expect(itemRows()).toContain('Prorated property taxes−$1,800.000.4%');
});

test('association dues are prorated over their period, and the letter and transfer fee follow who pays', async () => {
  await type('closingDate', '2026-06-15');
  await type('hoaDues', '300');
  expect(text()).toContain('You own the home for 14 of the 30 days in this period and have paid it, so the buyer returns $160.00 to you.');
  expect(itemRows()).toContain('Association dues refunded by the buyer+$160.000.04%');
  await press('a quarter', group('Dues are charged'));
  expect(text()).toContain('75 of the 91 days');
  await check('hoaPaid', false);
  expect(itemRows()).toContain('Prorated association dues−$247.250.05%');
  await type('hoaLetterFee', '250');
  await type('hoaTransferFee', '1000');
  await type('hoaPastDue', '450');
  expect(itemRows()).toContain('Association closing letter−$250.000.06%');
  expect(itemRows()).toContain('Unpaid association dues and assessments−$450.000.1%');
  expect(itemRows().some((row) => row.startsWith('Association transfer fee'))).toBe(false);
  await press('Seller', group('Transfer fee paid by'));
  expect(itemRows()).toContain('Association transfer fee−$1,000.000.22%');
  await press('Buyer', group('Closing letter paid by'));
  expect(itemRows().some((row) => row.startsWith('Association closing letter'))).toBe(false);
});

test('a seller living outside Georgia sees the 3% withholding, with the principal-residence exemption and the gain affidavit', async () => {
  expect(field('gainAmount')).toBeNull();
  await type('sellerResidency', 'us');
  // Principal residence is ticked by default, so the withholding is exempt.
  expect(itemRows().some((row) => row.includes('withholding'))).toBe(false);
  expect(text()).toContain('exempt: principal residence');
  await check('principalResidence', false);
  expect(itemRows()).toContain('Georgia nonresident withholding (3% of price)−$13,500.003%');
  expect(text()).toContain('O.C.G.A. 48-7-128');
  expect(hero()).toBe('$186,275');
  await press('My gain (affidavit)', group('Georgia withholding based on'));
  await type('gainAmount', '80000');
  expect(itemRows()).toContain('Georgia nonresident withholding (3% of gain)−$2,400.000.53%');
  expect(text()).toContain('IT-AFF2');
});

test('a seller who is not a US resident also sees FIRPTA, by price and the buyer\'s use', async () => {
  await type('sellerResidency', 'foreign');
  expect(field('buyerWillOccupy').checked).toBe(true);
  // Principal residence: Georgia exempt, FIRPTA not.
  expect(itemRows()).toContain('FIRPTA federal withholding (10%)−$45,000.0010%');
  expect(itemRows().some((row) => row.startsWith('Georgia nonresident'))).toBe(false);
  await check('buyerWillOccupy', false);
  expect(itemRows()).toContain('FIRPTA federal withholding (15%)−$67,500.0015%');
  expect(text()).toContain('IRC 1445');
  await type('salePrice', '280000');
  await check('buyerWillOccupy', true);
  expect(itemRows().some((row) => row.startsWith('FIRPTA'))).toBe(false);
  expect(text()).toContain('no withholding because the price is $300,000 or less');
});

test('the ring shows where the sale price goes, by group', async () => {
  await press('3%', group('Listing rate'));
  await type('concessions', '5000');
  const picture = container.querySelector('.calc-donut svg');
  expect(picture.getAttribute('aria-label')).toContain('Sale price of $450,000 by part.');
  expect(picture.getAttribute('aria-label')).toContain('You keep (net proceeds) $181,275');
  expect(legendRows().map((row) => row.replace(/\$[\d,]+\d+%$/, ''))).toEqual(['You keep (net proceeds)', 'Loans and liens', 'Commission', 'Closing costs', 'Credits to the buyer']);
  expect(container.querySelector('.calc-legend caption').textContent).toBe('Where the sale price goes');
  expect(container.querySelector('.calc-legend tfoot').textContent).toBe('Total$450,000100%');
  expect(container.querySelector('.calc-donut__center span').textContent).toBe('sale price');
});

test('a second offer is compared on net', async () => {
  expect(container.querySelector('[aria-label="Offer comparison"]')).toBeNull();
  await type('closingDate', '2026-06-15');
  await press('3%', group('Listing rate'));
  await type('buyerPct', '2.5');
  await type('concessions', '5000');
  await check('compare', true);
  await type('offerPrice', '442000');
  await type('offerConcessions', '0');
  await type('offerClosingDate', '2026-06-30');
  const block = container.querySelector('[aria-label="Offer comparison"]');
  const cells = (label) => [...block.querySelectorAll('tbody tr, tfoot tr')].find((row) => row.querySelector('th').textContent === label).querySelectorAll('td');
  expect([...cells('Sale price')].map((cell) => cell.textContent)).toEqual(['$450,000', '$442,000']);
  expect([...cells('Contribution to buyer\'s costs')].map((cell) => cell.textContent)).toEqual(['−$5,000', '−$0']);
  expect([...cells('Commission')].map((cell) => cell.textContent)).toEqual(['−$24,750', '−$24,310']);
  expect(block.textContent).toMatch(/Offer B nets \$[\d,]+ (more|less) than offer A\./);
  expect(block.textContent).toContain('Sellers decide on net, not on price.');
});

test('the staircase runs from the sale price to the net, one named row per line', async () => {
  await press('3%', group('Listing rate'));
  await type('concessions', '5000');
  const rows = waterfall().map((row) => row.textContent);
  expect(rows[0]).toBe('Sale price$450,000');
  expect(rows).toContain('Mortgage payoff (estimated)−$250,050');
  expect(rows).toContain('Contribution to the buyer\'s closing costs−$5,000');
  expect(rows[rows.length - 1]).toBe('Estimated net proceeds$181,275');
});

test('choosing a row says what is left after it', async () => {
  const detail = () => container.querySelector('.calc-waterfall__detail').textContent;
  expect(detail()).toBe('Select a row to see what is left after that line.');
  const payoff = waterfall().find((row) => row.textContent.startsWith('Mortgage payoff'));
  expect(payoff.tabIndex).toBe(0);
  await act(async () => { payoff.focus(); });
  expect(detail()).toBe('After mortgage payoff (estimated): $199,950 left.');
  await act(async () => { payoff.blur(); });
  expect(detail()).toBe('Select a row to see what is left after that line.');
});

test('bars sit on one scale from the lowest figure to the highest', () => {
  const { rows, zero } = waterfallLayout([
    { key: 'salePrice', kind: 'total', start: 0, end: 400 },
    { key: 'payoff', kind: 'deduction', start: 400, end: 100, amount: 300 },
    { key: 'net', kind: 'total', start: 0, end: 100 },
  ]);
  expect(zero).toBe(0);
  expect(rows.map((row) => [row.left, row.width])).toEqual([[0, 100], [25, 75], [0, 25]]);
  const short = waterfallLayout([
    { key: 'salePrice', kind: 'total', start: 0, end: 300 },
    { key: 'payoff', kind: 'deduction', start: 300, end: -100, amount: 400 },
    { key: 'net', kind: 'total', start: 0, end: -100 },
  ]);
  expect(short.zero).toBe(25);
  expect(short.rows[2]).toMatchObject({ left: 0, width: 25 });
});

test('owing more than the sale brings is shown as a shortfall', async () => {
  await type('mortgageBalance', '460000');
  expect(text()).toContain('ESTIMATED SHORTFALL AT CLOSING');
  expect(hero()).toBe('−$10,225');
  expect(container.querySelector('.calc-hero').className).toContain('calc-hero--shortfall');
  expect(text()).toContain('you would need to bring money to closing');
  const last = waterfall()[waterfall().length - 1];
  expect(last.textContent).toBe('Shortfall at closing−$10,225');
  expect(last.className).toContain('is-shortfall');
  // The ring has nothing to show for the net.
  expect(legendRows().some((row) => row.startsWith('You keep'))).toBe(false);
});

test('the calls to action: a valuation that is not an appraisal, print, and figures only when ticked', async () => {
  const action = container.querySelector('.calc-cta a');
  expect(action.textContent.trim()).toBe('Request a home valuation');
  expect(action.getAttribute('href')).toBe('/inquire?type=seller&topic=net-sheet');
  expect(container.querySelector('.calc-cta button').textContent.trim()).toBe('Print this estimate');
  expect(text()).toContain("an agent's opinion of price from comparable sales. It is not an appraisal.");
  expect(text()).toContain('not a settlement statement');
  expect(text()).toContain('What the attorney will ask you for');
  expect(text().toLowerCase()).not.toContain('accurate');
  const share = container.querySelector('.calc-check--share input');
  await act(async () => { share.click(); });
  const carried = decodeURIComponent(container.querySelector('.calc-cta a').getAttribute('href'));
  expect(carried).toContain('&figures=Sale price $450,000.');
  expect(carried).toContain('Estimated net proceeds $199,775');
  expect(carried).not.toMatch(/name|email|phone/i);
  await act(async () => { share.click(); });
  expect(container.querySelector('.calc-cta a').getAttribute('href')).toBe('/inquire?type=seller&topic=net-sheet');
});

test('with no sale price the panel asks for one', async () => {
  await type('salePrice', '');
  expect(text()).toContain('Enter a sale price');
  expect(container.querySelector('.calc-hero')).toBeNull();
  expect(text()).not.toContain('NaN');
});

test('every field has a label, and every checkbox sits in one', () => {
  container.querySelectorAll('input:not([type="checkbox"]), select').forEach((control) => {
    expect(container.querySelector(`label[for="${control.id}"]`)).not.toBeNull();
  });
  container.querySelectorAll('input[type="checkbox"]').forEach((control) => {
    expect(control.closest('label')).not.toBeNull();
  });
  expect(field('taxBillPaid').closest('label').textContent).toBe("I have already paid this year's bill");
});
