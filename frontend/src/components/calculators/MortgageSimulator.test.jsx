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

test('opens on a labelled example with the total, its parts and the limits of the estimate', async () => {
  await mount();
  expect(text()).toContain('The figures below are an example, not a listing or a rate quote.');
  expect(text()).toContain('Nothing you type here is saved or sent.');
  expect(hero()).toBe('$2,875');
  expect(legendRows()).toEqual(['Principal & interest$2,27579%', 'Property taxes$45016%', 'Homeowners insurance$1505%']);
  expect(container.querySelector('.calc-legend tfoot').textContent).toBe('Total$2,875100%');
  expect(text()).toContain('It is not a loan offer, a rate quote or a commitment to lend');
  expect(text()).toContain("A lender's Loan Estimate states the actual payment.");
});

test('the ring is a labelled picture of the same figures', async () => {
  await mount();
  const picture = container.querySelector('.calc-donut svg');
  expect(picture.getAttribute('role')).toBe('img');
  expect(picture.getAttribute('aria-label')).toContain('Monthly payment of $2,875 by part.');
  expect(picture.getAttribute('aria-label')).toContain('Principal & interest $2,275, 79%');
  expect(container.querySelectorAll('.calc-donut svg path')).toHaveLength(3);
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

test('a down payment under 20% adds mortgage insurance and says when it ends', async () => {
  await mount();
  expect(field('pmiRatePct')).toBeNull();
  expect(text()).toContain('No mortgage insurance: the down payment is 20% or more.');
  await type('downPayment', '5');
  expect(field('pmiRatePct').value).toBe('0.5');
  expect(text()).toContain('Added because the down payment is under 20%: $178.13 a month.');
  expect(hero()).toBe('$3,480');
  expect(legendRows()).toContain('Mortgage insurance (PMI)$1785%');
  expect(text()).toContain('ends after month 135 (year 12)');
  expect(text()).toContain('FHA and other government loans work differently.');
  expect([...container.querySelectorAll('.calc-table thead th')].map((cell) => cell.textContent)).toEqual(['Year', 'Principal', 'Interest', 'PMI', 'Balance']);
});

test('the down payment switches between percent and dollars without changing the loan', async () => {
  await mount();
  await press('Dollars', group('Down payment entered as'));
  expect(field('downPayment').value).toBe('90000');
  expect(hero()).toBe('$2,875');
  await type('downPayment', '45000');
  expect(text()).toContain('$45,000 down (10%), so the loan is $405,000.');
  await press('Percent of the price', group('Down payment entered as'));
  expect(field('downPayment').value).toBe('10');
  expect(text()).toContain('$45,000 down (10%), so the loan is $405,000.');
});

test('property taxes default to 1.2% of the price, labelled as a placeholder, and take a dollar figure', async () => {
  await mount();
  expect(field('propertyTax').value).toBe('1.2');
  expect(text()).toContain('$5,400 a year. 1.2% of the price is a placeholder, not a county\'s rate');
  await press('Dollars', group('Property taxes entered as'));
  expect(field('propertyTax').value).toBe('5400');
  await type('propertyTax', '6000');
  expect(text()).toContain('$500 a month.');
  expect(hero()).toBe('$2,925');
});

test('insurance switches between a yearly and a monthly figure', async () => {
  await mount();
  await press('Per month', group('Insurance entered per'));
  expect(field('insurance').value).toBe('150');
  expect(hero()).toBe('$2,875');
  await type('insurance', '200');
  expect(hero()).toBe('$2,925');
});

test('an adjustable loan shows the payment after the fixed years, at a rate the visitor owns', async () => {
  await mount();
  expect(field('laterRatePct')).toBeNull();
  await type('program', 'arm5');
  expect(field('laterRatePct').value).toBe('8.5');
  expect(text()).toContain('Rate after year 5 (your assumption)');
  expect(text()).toContain('Nobody knows this rate today.');
  expect(text()).toContain('After year 5: $3,314 a month if the rate moves to 8.5%');
  expect(text()).toContain('for the first 5 years');
  await type('laterRatePct', '');
  expect(text()).toContain('No later rate is entered');
});

test('the schedule switches between yearly and monthly rows', async () => {
  await mount();
  const rows = () => container.querySelectorAll('.calc-table tbody tr');
  expect(rows()).toHaveLength(30);
  expect(rows()[0].textContent).toBe('1$4,024$23,282$355,976');
  await press('Monthly');
  expect(rows()).toHaveLength(360);
  expect(rows()[0].textContent).toBe('1$325.44$1,950.00$359,674.56');
  expect(rows()[359].textContent).toContain('$0.00');
  expect(container.querySelector('.calc-table-scroll').getAttribute('aria-label')).toBe('Amortization schedule, month by month');
  await press('Yearly');
  expect(rows()).toHaveLength(30);
});

test('the call to action goes to the buyer request, and no financing service is offered', async () => {
  await mount();
  const action = container.querySelector('.calc-cta a');
  expect(action.textContent.trim()).toBe('Contact an agent about this purchase');
  expect(action.getAttribute('href')).toBe('/inquire?type=buyer');
  expect(text().toLowerCase()).not.toContain('pre-approv');
  expect(text().toLowerCase()).not.toContain('prequal');
});

test('a link from a listing fills the price, taxes and HOA fee and says where they came from', async () => {
  await mount('?tool=mortgage&price=525000&taxes=6100&hoa=140');
  expect(field('price').value).toBe('525000');
  expect(field('propertyTax').value).toBe('6100');
  expect(field('hoaMonthly').value).toBe('140');
  expect(text()).toContain('The price, yearly property taxes and monthly HOA fee came from the link you followed. Check them against the listing.');
  expect(text()).not.toContain('The figures below are an example');
  expect(container.querySelector('.calc-cta a').textContent.trim()).toBe('Contact an agent about this property');
  // 420,000 at 6.5% for 30 years is $2,654.69; plus 508.33 + 150 + 140.
  expect(hero()).toBe('$3,453');
});

test('a link with only a price leaves the other figures as examples', async () => {
  await mount('?tool=mortgage&price=300000');
  expect(field('price').value).toBe('300000');
  expect(field('propertyTax').value).toBe('1.2');
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
  container.querySelectorAll('input, select').forEach((control) => {
    expect(container.querySelector(`label[for="${control.id}"]`)).not.toBeNull();
  });
  const buttons = [...group('Down payment entered as').querySelectorAll('button')];
  expect(buttons.map((item) => [item.getAttribute('aria-label'), item.getAttribute('aria-pressed')])).toEqual([['Dollars', 'false'], ['Percent of the price', 'true']]);
});
