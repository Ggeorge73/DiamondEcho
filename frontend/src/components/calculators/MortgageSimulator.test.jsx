import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import MortgageSimulator from './MortgageSimulator';
import { donutSegments } from './PaymentDonut';
import { helpers } from './testHelpers';

let container;
let root;
const { text, field, type, press, group } = helpers(() => container);
const hero = () => container.querySelector('.calc-hero strong').textContent;
const legendRows = () => [...container.querySelectorAll('.calc-legend tbody tr')].map((row) => row.textContent);
const cashRows = () => Object.fromEntries([...container.querySelectorAll('[aria-label="Cash to close"] tr')].filter((row) => row.querySelector('td')).map((row) => [row.querySelector('th').textContent, row.querySelector('td').textContent]));
const check = async (name, checked) => {
  const control = field(name);
  await act(async () => { if (control.checked !== checked) control.click(); });
};
const mount = async (search = '') => {
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><MortgageSimulator search={search} /></MemoryRouter>); });
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

// The example: $450,000, 5% down, conventional 30-year at 6.5%, 740–759 credit,
// Gwinnett County (0.98%), $1,800 insurance. P&I 2,702.09 + tax 367.50 +
// insurance 150 + PMI 188.81 (0.53% card rate) = 3,408.40.
test('opens on a labelled example with the total, its parts and the limits of the estimate', async () => {
  await mount();
  expect(text()).toContain('The figures below are an example, not a listing, a rate quote or a lender\'s fee sheet.');
  expect(text()).toContain('Nothing you type here is saved or sent.');
  expect(hero()).toBe('$3,408');
  expect(legendRows()).toEqual(['Principal & interest$2,70279%', 'Property taxes$36811%', 'Homeowners insurance$1504%', 'Mortgage insurance (PMI)$1896%']);
  expect(container.querySelector('.calc-legend tfoot').textContent).toBe('Total$3,408100%');
  expect(text()).toContain('It is not a loan offer, a rate quote or a commitment to lend');
  expect(text()).toContain("A lender's Loan Estimate states the actual payment and costs.");
  expect(text()).toContain('diamond-mortgage-2.0.0');
});

test('the ring is a labelled picture of the same figures', async () => {
  await mount();
  const picture = container.querySelector('.calc-donut svg');
  expect(picture.getAttribute('role')).toBe('img');
  expect(picture.getAttribute('aria-label')).toContain('Monthly payment of $3,408 by part.');
  expect(picture.getAttribute('aria-label')).toContain('Principal & interest $2,702, 79%');
  expect(container.querySelectorAll('.calc-donut svg path')).toHaveLength(4);
});

test('ring segments cover the whole circle, leave a gap between neighbours and skip empty parts', () => {
  const segments = donutSegments([{ key: 'a', value: 300 }, { key: 'b', value: 0 }, { key: 'c', value: 100 }]);
  expect(segments.map((segment) => segment.key)).toEqual(['a', 'c']);
  expect(segments[0].share).toBe(75);
  expect(segments[0].from).toBeGreaterThan(0);
  expect(segments[0].to).toBeLessThan(270);
  expect(segments[1].from).toBeGreaterThan(270);
  expect(segments[1].to).toBeLessThan(360);
  const alone = donutSegments([{ key: 'a', value: 5 }]);
  expect(alone[0]).toMatchObject({ whole: true, share: 100 });
});

test('PMI comes from the credit band and LTV, says so, ends at 78%, and can be overridden', async () => {
  await mount();
  expect(field('pmiRatePct').value).toBe('0.53');
  expect(field('pmiRatePct').readOnly).toBe(true);
  expect(text()).toContain('$188.81 a month from a representative rate card at 740 – 759 and 95% loan-to-value.');
  expect(text()).toContain('ends after month 135 (year 12)');
  expect([...container.querySelectorAll('.calc-table thead th')].map((cell) => cell.textContent)).toEqual(['Year', 'Principal', 'Interest', 'PMI', 'Balance']);
  // A weaker score costs more.
  await type('creditBand', '660');
  expect(field('pmiRatePct').value).toBe('1.28');
  expect(hero()).toBe('$3,676');
  // The visitor's own quote wins when chosen.
  await press('My own PMI rate', group('PMI rate taken from'));
  expect(field('pmiRatePct').readOnly).toBe(false);
  await type('pmiRatePct', '0.5');
  expect(text()).toContain('$178.13 a month.');
  // 20% down: no PMI, and the field goes.
  await type('downPayment', '20');
  expect(field('pmiRatePct')).toBeNull();
  expect(text()).toContain('No mortgage insurance: the down payment is 20% or more.');
  expect(hero()).toBe('$2,793');
});

test('FHA adds the upfront premium to the loan and charges MIP for the life of the loan', async () => {
  await mount();
  await type('loanType', 'fha');
  await type('downPayment', '3.5');
  expect(text()).toContain('so the loan is $441,849 including the financed $7,599 upfront fee. Minimum for FHA: 3.5%.');
  expect(text()).toContain('FHA mortgage insurance (MIP): 0.55% of the balance a year, $202.51 in the first month, for the life of the loan.');
  expect(field('pmiRatePct')).toBeNull();
  expect(legendRows()[3]).toContain('FHA mortgage insurance (MIP)');
  expect([...container.querySelectorAll('.calc-table thead th')].map((cell) => cell.textContent)).toContain('MIP');
  expect(text()).toContain('Under 10% down it runs for the life of the loan');
  // Paying the premium at closing instead moves it to the cash to close.
  await check('financeUpfrontFee', false);
  expect(cashRows()['Upfront fee paid at closing']).toBe('$7,599');
  expect(text()).toContain('so the loan is $434,250.');
});

test('VA has no mortgage insurance, and the funding fee follows use and exemption', async () => {
  await mount();
  await type('loanType', 'va');
  await type('downPayment', '0');
  expect(text()).toContain('including the financed $9,675 upfront fee');
  expect(text()).toContain('No mortgage insurance: VA loans carry none.');
  expect(field('vaFirstUse').checked).toBe(true);
  await check('vaFirstUse', false);
  expect(text()).toContain('Add the 3.3% upfront fee ($14,850) to the loan');
  await check('vaExempt', true);
  expect(text()).toContain('so the loan is $450,000.');
  expect(field('financeUpfrontFee')).toBeNull();
});

test('USDA charges its annual fee on the balance and asks for a primary residence', async () => {
  await mount();
  await type('loanType', 'usda');
  await type('downPayment', '0');
  expect(text()).toContain('USDA annual fee: 0.35% of the balance a year, $132.56 in the first month, for the life of the loan.');
  await check('primaryResidence', false);
  expect(text()).toContain('USDA Rural Development loans are for a home you will live in.');
});

test('the down payment switches between percent and dollars without changing the loan', async () => {
  await mount();
  await press('Dollars', group('Down payment entered as'));
  expect(field('downPayment').value).toBe('22500');
  expect(hero()).toBe('$3,408');
  await type('downPayment', '45000');
  expect(text()).toContain('$45,000 down (10%), so the loan is $405,000.');
  await press('Percent of the price', group('Down payment entered as'));
  expect(field('downPayment').value).toBe('10');
  expect(text()).toContain('$45,000 down (10%), so the loan is $405,000.');
});

test('a county sets the tax rate as a labelled median; typing a figure takes over', async () => {
  await mount();
  expect(field('county').value).toBe('gwinnett');
  expect(field('propertyTax').value).toBe('0.98');
  expect(text()).toContain("$4,410 a year. Gwinnett's 0.98% is a county median, not this home's bill.");
  expect(text()).toContain('homestead must be filed with the county by April 1');
  await type('county', 'forsyth');
  expect(field('propertyTax').value).toBe('0.76');
  expect(hero()).toBe('$3,326');
  await press('Dollars', group('Property taxes entered as'));
  expect(field('propertyTax').value).toBe('3420');
  await type('propertyTax', '6000');
  expect(field('county').value).toBe('other');
  expect(text()).toContain('$500 a month. If this is the seller\'s bill it may carry their homestead or senior exemption.');
  expect(hero()).toBe('$3,541');
});

test('insurance switches between a yearly and a monthly figure', async () => {
  await mount();
  await press('Per month', group('Insurance entered per'));
  expect(field('insurance').value).toBe('150');
  expect(hero()).toBe('$3,408');
  await type('insurance', '200');
  expect(hero()).toBe('$3,458');
});

test('an adjustable loan shows the visitor\'s own later rate and the worst case under the caps', async () => {
  await mount();
  expect(field('laterRatePct')).toBeNull();
  await type('program', 'arm5');
  expect(field('laterRatePct').value).toBe('8.5');
  expect(text()).toContain('Rate after year 5 (your assumption)');
  expect(text()).toContain('worst case under 2/1/5 caps');
  expect(text()).toContain('After year 5: $3,929 a month if the rate moves to 8.5%');
  expect(text()).toContain('Worst case under 2/1/5 caps: $4,524 a month at 11.5% from year 9.');
  expect(text()).toContain('for the first 5 years');
  expect(field('extraMonthly')).toBeNull();
  await type('laterRatePct', '');
  expect(text()).toContain('No later rate is entered');
});

test('a temporary buydown shows the early-year payments and its cost', async () => {
  await mount();
  await type('buydown', '2-1');
  expect(text()).toContain('With the 2-1 buydown: $2,872 a month in year 1 at 4.5%, $3,134 a month in year 2 at 5.5%, then $3,408.');
  expect(text()).toContain('The buydown costs $9,730');
  expect(hero()).toBe('$3,408');
});

test('points and the Georgia intangible tax appear in the cash to close', async () => {
  await mount();
  const rows = cashRows();
  expect(rows['Down payment']).toBe('$22,500');
  expect(rows['Georgia intangible tax on the loan']).toBe('$1,283');
  expect(rows['Escrow reserve (3 months)']).toBe('$1,553');
  expect(rows['Prepaid interest (15 days)']).toBe('$1,142');
  expect(rows['Less earnest money already paid']).toBe('−$5,000');
  expect(rows['Due at closing']).toBe('$27,527');
  expect(rows['Total cash needed, including earnest money and fees paid earlier']).toBe('$33,527');
  expect(text()).toContain('Georgia Dream');
  expect(container.querySelector('a[href^="https://www.dca.ga.gov/"]').getAttribute('rel')).toBe('noopener noreferrer');
  await type('pointsPct', '1');
  expect(cashRows()['Discount points (1%)']).toBe('$4,275');
  expect(text()).toContain('Paid at closing to buy a lower rate: $4,275 here.');
  await type('sellerCredit', '20000');
  expect(cashRows()['Less seller credit']).toBe('−$13,500');
  expect(text()).toContain('A seller can pay at most 3% of the price');
});

test('income and debts give the debt-to-income check and the price the income carries', async () => {
  await mount();
  expect(container.querySelector('[aria-label="Affordability"]')).toBeNull();
  await type('annualIncome', '120000');
  await type('monthlyDebts', '600');
  const block = container.querySelector('[aria-label="Affordability"]');
  expect(block.textContent).toContain('Housing payment to income34.1%');
  expect(block.textContent).toContain('All debts to income40.1%Conventional usual ceiling 45%');
  expect(block.textContent).toContain('Within the usual limits');
  expect(block.textContent).toMatch(/Price this income carries\$\d{3},000/);
  await type('monthlyDebts', '1800');
  expect(container.querySelector('[aria-label="Affordability"]').textContent).toContain('Above the usual limits');
});

test('extra principal shows the shorter payoff and the interest saved', async () => {
  await mount();
  await type('extraMonthly', '300');
  expect(text()).toMatch(/Paying \$300 extra each month ends the loan after \d+ years instead of 30, \d+ months sooner, and saves about \$\d{2,3},\d{3} in interest\./);
});

test('the schedule switches between yearly and monthly rows', async () => {
  await mount();
  const rows = () => container.querySelectorAll('.calc-schedule .calc-table tbody tr');
  expect(rows()).toHaveLength(30);
  expect(rows()[0].textContent).toBe('1$4,778$27,647$2,266$422,722');
  await press('Monthly');
  expect(rows()).toHaveLength(360);
  expect(rows()[0].textContent).toBe('1$386.46$2,315.63$188.81$427,113.54');
  expect(rows()[359].textContent).toContain('$0.00');
  expect(container.querySelector('.calc-table-scroll').getAttribute('aria-label')).toBe('Amortization schedule, month by month');
  await press('Yearly');
  expect(rows()).toHaveLength(30);
});

test('the calls to action: pre-approval through an agent, a buyer request, the search, and print', async () => {
  await mount();
  const actions = [...container.querySelectorAll('.calc-cta a')].map((link) => [link.textContent.trim(), link.getAttribute('href')]);
  expect(actions).toEqual([
    ['Get pre-approved', '/inquire?type=buyer&topic=pre-approval'],
    ['Contact an agent about this purchase', '/inquire?type=buyer'],
    ['Search Georgia homes', '/search'],
  ]);
  expect(container.querySelector('.calc-cta button').textContent.trim()).toBe('Print this estimate');
  // The page does not pose as a lender, and the estimate is not called a pre-approval.
  expect(text()).toContain('DiamondEcho is not a lender. Pre-approval comes from a lender: send a request and an agent can introduce you to one.');
  expect(text().toLowerCase()).not.toContain('you are pre-approved');
  expect(text().toLowerCase()).not.toContain('prequal');
});

test('nothing typed travels in the pre-approval link unless the visitor ticks the box', async () => {
  await mount();
  await type('price', '777000');
  await type('downPayment', '13');
  const link = () => container.querySelector('.calc-cta a').getAttribute('href');
  expect(link()).toBe('/inquire?type=buyer&topic=pre-approval');
  expect(link()).not.toMatch(/777000|13/);
  expect(text()).toContain('The figures above are not sent with it.');
  const share = container.querySelector('.calc-check--share input');
  await act(async () => { share.click(); });
  const carried = decodeURIComponent(link());
  expect(carried).toContain('&figures=Price $777,000, 13% down ($101,010), Conventional 30-year fixed at 6.5%.');
  expect(carried).toContain('Estimated monthly payment $');
  expect(carried).toContain('Estimated cash to close $');
  expect(carried).not.toMatch(/name|email|phone/i);
  expect(text()).toContain('Your figures above will be in the message for you to edit.');
  await act(async () => { share.click(); });
  expect(link()).toBe('/inquire?type=buyer&topic=pre-approval');
});

test('a link from a listing fills the price, taxes and HOA fee and says where they came from', async () => {
  await mount('?tool=mortgage&price=525000&taxes=6100&hoa=140');
  expect(field('price').value).toBe('525000');
  expect(field('propertyTax').value).toBe('6100');
  expect(field('county').value).toBe('other');
  expect(field('hoaMonthly').value).toBe('140');
  expect(text()).toContain('The price, yearly property taxes and monthly HOA fee came from the link you followed. Check them against the listing.');
  expect(text()).not.toContain('The figures below are an example');
  expect(container.querySelectorAll('.calc-cta a')[1].textContent.trim()).toBe('Contact an agent about this property');
  // 498,750 at 6.5% for 30 years is $3,152.44; plus 508.33 + 150 + 140 + PMI 220.28 (0.53% of 498,750).
  expect(hero()).toBe('$4,171');
});

test('a link with only a price leaves the other figures as examples', async () => {
  await mount('?tool=mortgage&price=300000');
  expect(field('price').value).toBe('300000');
  expect(field('propertyTax').value).toBe('0.98');
  expect(text()).toContain('The price came from the link you followed. Check it against the listing.');
});

test('with no price the panel asks for one instead of showing zeros', async () => {
  await mount();
  await type('price', '');
  expect(text()).toContain('Enter a purchase price');
  expect(container.querySelector('.calc-hero')).toBeNull();
  expect(container.querySelector('.calc-sticky-total')).toBeNull();
  expect(text()).not.toContain('NaN');
});

test('every field has a label, and the unit buttons say what they do', async () => {
  await mount();
  container.querySelectorAll('input:not([type="checkbox"]), select').forEach((control) => {
    expect(container.querySelector(`label[for="${control.id}"]`)).not.toBeNull();
  });
  container.querySelectorAll('input[type="checkbox"]').forEach((control) => {
    expect(control.closest('label')).not.toBeNull();
  });
  const buttons = [...group('Down payment entered as').querySelectorAll('button')];
  expect(buttons.map((item) => [item.getAttribute('aria-label'), item.getAttribute('aria-pressed')])).toEqual([['Dollars', 'false'], ['Percent of the price', 'true']]);
});
