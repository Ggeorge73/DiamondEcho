import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import InvestmentCalculator, { EXAMPLE_ASSET_TYPES, exampleSwap, FLIP_EXAMPLE_SHARED, LAND_EXAMPLE_SHARED } from './InvestmentCalculator';

// DE-25. The Fix & flip tab opened on the apartment-building example held for
// five years, which read as a flip that lost $930,936 before the visitor had
// typed anything. The real calculation code runs here; only the network and
// the Excel download are faked.
jest.mock('react-router-dom', () => ({
  MemoryRouter: ({ children }) => children,
  Link: ({ to, children, ...rest }) => require('react').createElement('a', { href: to, ...rest }, children),
  useLocation: () => ({ pathname: '/investment-calculator', search: '' }),
  useNavigate: () => jest.fn(),
}));
jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../lib/dealWorkbook', () => ({ downloadDealWorkbook: jest.fn() }));

let container;
let root;

const text = () => container.textContent;
const field = (name) => container.querySelector(`[name="${name}"]`);
const button = (label) => [...container.querySelectorAll('button')].find((item) => item.textContent.includes(label));
const click = async (label) => { await act(async () => { button(label).click(); }); };
const setControl = async (name, value) => {
  const control = field(name);
  const proto = control.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setValue = Object.getOwnPropertyDescriptor(proto, 'value').set;
  await act(async () => {
    setValue.call(control, value);
    control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
};
const runBase = async () => {
  await act(async () => { button('Run base analysis').click(); });
  await act(async () => { await Promise.resolve(); });
};
const tile = (label) => [...container.querySelectorAll('.studio-metrics article')].find((item) => item.querySelector('small').textContent === label);
const notice = () => container.querySelector('.studio-change-notice');

const shared = Object.keys(FLIP_EXAMPLE_SHARED);
const building = {
  units: '12', rentableSquareFeet: '18000', purchasePrice: '3000000', closingCosts: '75000',
  dueDiligenceCosts: '25000', initialCapex: '125000', holdMonths: '60', interestOnlyMonths: '0', loanTermYears: '10',
};
const flipOnly = { arv: '360000', rehabCost: '65000', rehabContingency: '10', monthlyHolding: '1800', otherProjectCosts: '6000' };

beforeEach(async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  axios.get.mockResolvedValue({ data: { suggestions: [], provider: 'curated' } });
  container = document.createElement('div');
  document.body.appendChild(container);
  process.env.REACT_APP_BACKEND_URL = '';
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><InvestmentCalculator /></MemoryRouter>); });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  jest.clearAllMocks();
});

describe('the fix and flip tab has its own example', () => {
  test('opening the tab untouched shows one house priced under its screening figure, not a building that loses', async () => {
    await click('Fix & flip');
    for (const name of shared) expect(field(name).value).toBe(FLIP_EXAMPLE_SHARED[name]);
    for (const [name, value] of Object.entries(flipOnly)) expect(field(name).value).toBe(value);
    expect(field('propertyType').value).toBe('single_family');
    expect(notice().textContent).toBe('The example figures you had not changed, and the asset type, are now a fix-and-flip example (one single-family house). They are illustrations, not facts about any property.×');
    // The page already says, above the form, that prefilled numbers are illustrative.
    expect(text()).toContain('Manual Deal Studio entry. Any prefilled numbers are illustrative');
    await runBase();
    expect(tile('Projected profit').textContent).toContain('$48,149');
    expect(tile('Flip ROI').textContent).toContain('27.79%');
    expect(tile('Projected IRR').textContent).toContain('37.31%');
    expect(tile('Net present value').textContent).toContain('$32,289');
    expect(tile('Equity multiple').textContent).toContain('1.28');
    expect(tile('Loan-to-value').textContent).toContain('65%');
    expect(tile('Loan-to-cost').textContent).toContain('44.23%');
    expect(tile('70% screening threshold').textContent).toContain('$180,500');
    // The example is priced just under the page's own screening figure.
    expect(Number(FLIP_EXAMPLE_SHARED.purchasePrice)).toBeLessThan(180500);
    expect(text()).not.toContain('-$930,936');
    expect(text()).toContain('Illustrative analysis only.');
  });

  test('going back to Rental & commercial puts the building example back', async () => {
    await click('Fix & flip');
    await click('Rental & commercial');
    for (const [name, value] of Object.entries(building)) expect(field(name).value).toBe(value);
    expect(field('propertyType').value).toBe('multifamily');
    expect(notice().textContent).toBe('The example figures you had not changed, and the asset type, are the building example again.×');
  });

  test('a figure the visitor typed is never swapped, in either direction', async () => {
    await setControl('purchasePrice', '412000');
    await setControl('units', '2');
    await click('Fix & flip');
    expect(field('purchasePrice').value).toBe('412000');
    expect(field('units').value).toBe('2');
    expect(field('closingCosts').value).toBe('5500');       // untouched, so it followed the tab
    expect(notice().textContent).toContain('These example figures, which you had not changed, were set for a fix and flip: asset type, square feet, closing costs, due diligence, initial capital work, hold period, interest-only period, loan term.');
    await setControl('holdMonths', '5');
    await click('Rental & commercial');
    expect(field('purchasePrice').value).toBe('412000');
    expect(field('units').value).toBe('2');
    expect(field('holdMonths').value).toBe('5');
    expect(field('closingCosts').value).toBe('75000');      // still an example, so it went back
  });

  test('an asset type the visitor chose stays, and the note does not claim it moved', async () => {
    await setControl('propertyType', 'condo');
    await click('Fix & flip');
    expect(field('propertyType').value).toBe('condo');
    expect(field('purchasePrice').value).toBe('180000');
    expect(notice().textContent).toBe('The example figures you had not changed are now a fix-and-flip example (one single-family house). They are illustrations, not facts about any property.×');
    await click('Rental & commercial');
    expect(field('propertyType').value).toBe('condo');
  });

  test('figures cleared for an address stay cleared, and the boxes that do change are named', async () => {
    await click('Fix & flip');
    await setControl('address', '12 Example Rd');
    expect(field('purchasePrice').value).toBe('');
    expect(field('arv').value).toBe('');
    expect(field('holdMonths').value).toBe('10');           // not a fact about an address, so never cleared
    await click('Rental & commercial');
    expect(field('purchasePrice').value).toBe('');
    expect(field('units').value).toBe('');
    expect(field('holdMonths').value).toBe('60');
    expect(notice().textContent).toContain('were set back for a building: asset type, hold period, interest-only period, loan term.');
    await click('Fix & flip');
    expect(field('purchasePrice').value).toBe('');
    expect(notice().textContent).not.toContain('one single-family house');
    expect(notice().textContent).toContain('were set for a fix and flip: asset type, hold period, interest-only period, loan term.');
  });

  test('the land tab and the flip tab hand over to each other', async () => {
    await click('Fix & flip');
    await click('Land development');
    expect(field('propertyType').value).toBe('land');
    expect(field('units').value).toBe('12');
    expect(field('purchasePrice').value).toBe(LAND_EXAMPLE_SHARED.purchasePrice);
    expect(notice().textContent).toContain('Asset type set to Lot / land for the Land development tab. It is set back when you leave this tab.');
    await click('Rental & commercial');
    // The type before land was the flip example's, so the building tab gets the building's.
    expect(field('propertyType').value).toBe('multifamily');
    expect(notice().textContent).toContain('Asset type set to Multifamily, because Lot / land is analysed only on the Land development tab.');
    for (const [name, value] of Object.entries(building)) expect(field(name).value).toBe(value);
    await click('Land development');
    await click('Fix & flip');
    expect(field('propertyType').value).toBe('single_family');
    for (const name of shared) expect(field(name).value).toBe(FLIP_EXAMPLE_SHARED[name]);
  });

  test('no example figure is an empty box, which is what a cleared figure looks like', () => {
    expect([...shared].sort()).toEqual(Object.keys(building).sort());
    Object.values(FLIP_EXAMPLE_SHARED).forEach((value) => expect(value).not.toBe(''));
    Object.values(flipOnly).forEach((value) => expect(value).not.toBe(''));
    expect(EXAMPLE_ASSET_TYPES).toEqual({ rental: 'multifamily', flip: 'single_family' });
  });

  test('exampleSwap moves only untouched examples, between any two tabs', () => {
    expect(exampleSwap(building, 'rental', 'flip')).toEqual({ ...FLIP_EXAMPLE_SHARED });
    expect(exampleSwap({ ...FLIP_EXAMPLE_SHARED }, 'flip', 'rental')).toEqual(building);
    // Flip to land: units, square feet and due diligence go back to the shared figures; capital work is 0 in both.
    expect(exampleSwap({ ...FLIP_EXAMPLE_SHARED }, 'flip', 'land')).toEqual({
      units: '12', rentableSquareFeet: '18000', dueDiligenceCosts: '25000',
      purchasePrice: '375000', closingCosts: '15000', holdMonths: '24', interestOnlyMonths: '24', loanTermYears: '2',
    });
    expect(exampleSwap({ ...FLIP_EXAMPLE_SHARED }, 'flip', 'flip')).toEqual({});
    expect(exampleSwap({ ...building, purchasePrice: '1' }, 'rental', 'flip').purchasePrice).toBeUndefined();
    // A box that is the visitor's, or was loaded for an address, is held even when it equals the example.
    expect(exampleSwap({ ...FLIP_EXAMPLE_SHARED }, 'flip', 'rental', new Set(['units'])).units).toBeUndefined();
    expect(exampleSwap({ ...FLIP_EXAMPLE_SHARED, purchasePrice: '' }, 'flip', 'rental').purchasePrice).toBeUndefined();
  });
});
