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

// Items 1 and 3 of the 2026-10-22 review of the Fix & flip tab: the Monte
// Carlo interest band was hidden on this tab and stayed at the example's
// 6.75% whatever rate was typed, and the tab had no Go / No-Go decision.
describe('the fix and flip tab has a decision', () => {
  // A rural fixer: $93,000 price, hard-money loan at 70% / 11% / interest
  // only / 2 points, $85,000 rehab with a 15% contingency, $250,000
  // after-repair value, seven-month hold. The figures were checked by hand.
  const ruralFixer = {
    purchasePrice: '93000', closingCosts: '3000', dueDiligenceCosts: '2000', initialCapex: '0', holdMonths: '7',
    ltv: '70', interestRate: '11', interestOnlyMonths: '7', loanTermYears: '1', originationFee: '2',
    arv: '250000', rehabCost: '85000', rehabContingency: '15', monthlyHolding: '450', otherProjectCosts: '4000', sellingCosts: '7',
    rentableSquareFeet: '1655',
  };
  const enterFixer = async (changes = {}) => {
    for (const [name, value] of Object.entries({ ...ruralFixer, ...changes })) await setControl(name, value);
  };
  const kpis = () => [...container.querySelectorAll('.studio-decision-kpis article')].map((item) => item.textContent);

  test('the tab offers an IC decision, and the untouched example is a conditional Go', async () => {
    await click('Fix & flip');
    expect(button('IC decision')).toBeTruthy();
    expect(button('Base case')).toBeUndefined();
    expect(field('flipMinimumProfit').value).toBe('30000');
    expect(field('flipTargetRoi').value).toBe('20');
    await runBase();
    const verdict = container.querySelector('.studio-result__verdict');
    expect(verdict.className).toContain('studio-result__verdict--amber');
    expect(verdict.textContent).toContain('CONDITIONAL GO — VERIFY BEFORE CLOSING');
    expect(verdict.textContent).toContain('At $180,000 the deal is modeled to earn $48,149 (27.79% on cash), which meets your targets. The highest price that still meets them is $192,034.');
    expect(kpis()[0]).toContain('MAXIMUM OFFER$192,000Exact modeled ceiling $192,034');
    expect(kpis()[1]).toContain('$12,000 below');
    expect(kpis()[2]).toContain('PROFIT AT THIS PRICE$48,14927.79% on cash; minimum $30,000');
    expect(kpis()[3]).toContain('0 of 7 evidence items verified');
    expect(text()).toContain('BREAK-EVEN AFTER-REPAIR VALUE');
    expect(text()).toContain('HIGHEST PRICE THAT MEETS EACH TARGET');
    expect(text()).toContain('70% rule screening figure');
    expect(text()).toContain('SCREEN');
    // The transparent model output is still there under the decision.
    expect(tile('Projected profit').textContent).toContain('$48,149');
    expect(text()).toContain('diamond-decision-1.3.0');
  });

  test('a flip priced above its ceiling is a No-Go that names the price that would work', async () => {
    await click('Fix & flip');
    await enterFixer();
    await runBase();
    const verdict = container.querySelector('.studio-result__verdict');
    expect(verdict.className).toContain('studio-result__verdict--red');
    expect(verdict.textContent).toContain('NO-GO AT THIS PRICE — REPRICE OR PASS');
    expect(verdict.textContent).toContain('At $93,000 the deal is modeled to earn $24,121 (16.83% on cash), short of your $30,000 minimum profit and your 20% return on cash. The highest price that meets your targets is $87,447, which is $5,553 below this price.');
    expect(kpis()[0]).toContain('MAXIMUM OFFER$87,000Exact modeled ceiling $87,447');
    expect(kpis()[1]).toContain('$6,000 overPurchase price $93,000 · open at $80,000–$84,000');
    const ceilings = [...container.querySelectorAll('.studio-ceiling-list > div')].map((row) => row.textContent);
    expect(ceilings[0]).toContain('$30,000 minimum profit');
    expect(ceilings[0]).toContain('$87,447BINDING');
    expect(ceilings[1]).toContain('20% return on cash');
    expect(ceilings[2]).toContain('70% rule screening figure');
    expect(ceilings[2]).toContain('$77,250SCREEN');
    expect(text()).toContain('The price is $15,750 above the 70% rule screening figure of $77,250.');
    expect(text()).toContain('The downside case loses $2,269.');
    const rows = [...container.querySelectorAll('.studio-scenario-row')].map((row) => row.textContent);
    expect(rows[0]).toBe('CaseProfitMarginROIIRR');
    expect(rows[2]).toContain('Base$24,121');
    expect(tile('70% screening threshold').textContent).toContain('$77,250');
  });

  test('at a price that meets the targets with every item verified, the call is Go', async () => {
    await click('Fix & flip');
    await enterFixer({ purchasePrice: '77000' });
    const boxes = [...container.querySelectorAll('.studio-evidence-grid input[type="checkbox"]')];
    expect(boxes).toHaveLength(7);
    for (const box of boxes) await act(async () => { box.click(); });
    await runBase();
    const verdict = container.querySelector('.studio-result__verdict');
    expect(verdict.className).toContain('studio-result__verdict--green');
    expect(verdict.textContent).toContain('GO — MEETS YOUR TARGETS');
    expect(text()).toContain('7 of 7 evidence items verified');
  });
});

describe('the Monte Carlo interest band on the fix and flip tab', () => {
  const band = () => ['mcInterestMin', 'mcInterestMode', 'mcInterestMax'].map((name) => field(name).value);

  test('the band is on the tab and follows the entered interest rate', async () => {
    await click('Fix & flip');
    expect(band()).toEqual(['5.75', '6.75', '8.5']);
    expect(text()).toContain('follows the interest rate you entered until you change the band yourself');
    expect(text()).toContain('A rehab overrun drawn here replaces the contingency rather than adding to it');
    await setControl('interestRate', '11');
    expect(band()).toEqual(['10', '11', '12.75']);
    await setControl('interestRate', '0.5');
    expect(band()).toEqual(['0', '0.5', '2.25']);
    // The three fields are what the simulation reads, so the simulated loan is at the entered rate.
    await setControl('interestRate', '11');
    await click('Rental & commercial');
    expect(band()).toEqual(['10', '11', '12.75']);
  });

  test('a band the visitor set stays put when the rate changes again', async () => {
    await click('Fix & flip');
    await setControl('mcInterestMode', '9');
    await setControl('interestRate', '12');
    expect(band()).toEqual(['5.75', '9', '8.5']);
  });

  test('the simulation on this tab runs on the entered rate and shows its results', async () => {
    await click('Fix & flip');
    await setControl('interestRate', '11');
    await setControl('mcIterations', '1000');
    await act(async () => { button('Run Monte Carlo').click(); });
    for (let wait = 0; wait < 100 && !container.querySelector('.studio-risk-results article'); wait += 1) {
      await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 20); }); });
    }
    const cards = [...container.querySelectorAll('.studio-risk-results article')];
    expect(cards).toHaveLength(3);
    for (const card of cards) expect(card.querySelector('small').textContent).toContain('Requested 1,000 · Completed 1,000 · Excluded 0 · Valid for Projected profit 1,000');
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('rehab financing and the hold-period band on the fix and flip tab', () => {
  test('the loan can fund a share of the rehab, and loan-to-cost says so', async () => {
    await click('Fix & flip');
    expect(field('rehabFinanced').value).toBe('0');
    expect(text()).toContain('plus this share of the rehabilitation budget');
    await runBase();
    expect(tile('Loan-to-cost').textContent).toContain('44.23%');
    await setControl('rehabFinanced', '100');
    await runBase();
    // 65% of $180,000 plus all of the $65,000 budget: $182,000 on $264,500 of cost.
    expect(tile('Loan-to-cost').textContent).toContain('68.81%');
    expect(tile('Loan-to-value').textContent).toContain('101.11%');
    expect(tile('Projected profit').textContent).not.toContain('$48,149');
  });

  test('the hold-period band is on the tab in months, and the rental tab does not have it', async () => {
    await click('Fix & flip');
    expect(['mcHoldMin', 'mcHoldMode', 'mcHoldMax'].map((name) => field(name).value)).toEqual(['0', '1', '4']);
    expect(text()).toContain('The hold period change is in months');
    await click('Land development');
    expect(field('mcHoldMode')).toBeTruthy();
    await click('Rental & commercial');
    expect(field('mcHoldMode')).toBeNull();
  });
});
