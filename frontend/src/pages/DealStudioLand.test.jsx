import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import InvestmentCalculator, { exampleSwap, LAND_EXAMPLE_SHARED, landServiceFormulaIsCurrent } from './InvestmentCalculator';

// DE-25. The real calculation and decision code runs here; only the network
// and the Excel download are faked.
jest.mock('react-router-dom', () => ({
  MemoryRouter: ({ children }) => children,
  // The tool switcher above the form is three links.
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

// A two-and-a-half-acre, four-lot deal priced above what its targets support.
const deal = {
  purchasePrice: '985000', closingCosts: '20000', dueDiligenceCosts: '15000', initialCapex: '0', holdMonths: '24',
  interestOnlyMonths: '24', loanTermYears: '2', units: '4', rentableSquareFeet: '12000', developmentMonths: '18',
  absorptionMonths: '6', siteWorkCost: '250000', hardConstructionCost: '1400000', softCosts: '150000',
  permitsImpactFees: '60000', developerFee: '80000', annualCarryingCosts: '24000', expectedTerminalValue: '4300000',
};
const enterDeal = async (changes = {}) => {
  for (const [name, value] of Object.entries({ ...deal, ...changes })) await setControl(name, value);
};
const mount = async (backend = '') => {
  process.env.REACT_APP_BACKEND_URL = backend;
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><InvestmentCalculator /></MemoryRouter>); });
};

beforeEach(async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  axios.get.mockResolvedValue({ data: { suggestions: [], provider: 'curated' } });
  container = document.createElement('div');
  document.body.appendChild(container);
  await mount();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  delete process.env.REACT_APP_BACKEND_URL;
  jest.useRealTimers();
});

describe('land development Go / No-Go', () => {
  test('a land deal gets a decision: the call, the highest workable land price and the profit', async () => {
    await click('Land development');
    expect(button('IC decision')).toBeTruthy();
    await enterDeal();
    await runBase();
    const verdict = container.querySelector('.studio-result__verdict');
    expect(verdict.className).toContain('studio-result__verdict--red');
    expect(verdict.textContent).toContain('NO-GO AT THIS PRICE — REPRICE OR PASS');
    expect(verdict.textContent).toContain('At $985,000 the deal is modeled to earn $574,469 (13.36% of exit value), short of your 20% margin target.');
    const kpis = [...container.querySelectorAll('.studio-decision-kpis article')].map((item) => item.textContent);
    expect(kpis[0]).toContain('MAXIMUM LAND PRICE$720,000Exact modeled ceiling $724,062');
    expect(kpis[1]).toContain('$265,000 over');
    expect(kpis[2]).toContain('PROFIT AT THIS PRICE$574,46913.36% of exit value; target 20%');
    expect(kpis[3]).toContain('0 of 10 diligence items verified');
    expect(text()).toContain('BREAK-EVEN EXIT VALUE');
    expect(text()).toContain('SAFETY CUSHION');
    expect(text()).toContain('HIGHEST LAND PRICE THAT MEETS EACH TARGET');
    // Three cases, with profit and margin for each.
    const rows = [...container.querySelectorAll('.studio-scenario-row')].map((row) => row.textContent);
    expect(rows[0]).toBe('CaseProfitMarginROIIRR');
    expect(rows.slice(1).map((row) => row.split('$')[0].replace('-', ''))).toEqual(['Downside', 'Base', 'Upside']);
    expect(text()).toContain('The downside case loses $93,752.');
  });

  test('the residual land value shown beside the decision is the same number as the ceiling', async () => {
    await click('Land development');
    await enterDeal();
    await runBase();
    expect(tile('Residual land value').querySelector('strong').textContent).toBe('$724,062');
    expect(tile('Development margin').querySelector('strong').textContent).toBe('13.36%');
    expect(text()).toContain('The modeled residual land value is below the proposed purchase price, so the deal misses the selected target margin at this price.');
  });

  test('at a price that meets the targets with the diligence verified, the call is Go', async () => {
    await click('Land development');
    await enterDeal({ purchasePrice: '650000', floodZone: 'X' });
    await setControl('entitlementStatus', 'fully_entitled');
    await setControl('utilityStatus', 'available');
    await setControl('accessStatus', 'legal_confirmed');
    await setControl('environmentalStatus', 'clear');
    await setControl('geotechnicalStatus', 'complete_suitable');
    const boxes = [...container.querySelectorAll('.studio-evidence-grid input[type="checkbox"]')];
    expect(boxes).toHaveLength(4);
    for (const box of boxes) await act(async () => { box.click(); });
    await runBase();
    const verdict = container.querySelector('.studio-result__verdict');
    expect(verdict.className).toContain('studio-result__verdict--green');
    expect(verdict.textContent).toContain('GO — MEETS YOUR TARGETS');
    expect(text()).toContain('10 of 10 diligence items verified');
    expect(text()).toContain('Diligence checklist complete');
  });

  test('the rental tab keeps its decision and fix and flip still has a plain base case', async () => {
    await runBase();
    expect(text()).toContain('RECOMMENDED MAXIMUM');
    expect(text()).not.toContain('MAXIMUM LAND PRICE');
    await click('Fix & flip');
    expect(button('Base case')).toBeTruthy();
    await runBase();
    expect(text()).toContain('Analysis complete');
  });
});

describe('the service and the page agree on land', () => {
  const oldService = { strategy: 'land', formula_version: 'diamond-underwriting-1.0.0', warnings: ['From the service.'], metrics: { residual_land_value: { value: 1013695, unit: 'USD', formula: 'old' } } };

  test('a service still on the older land formula is not shown: the page calculates on the device', async () => {
    await act(async () => { root.unmount(); });
    await mount('https://example.test');
    axios.post.mockResolvedValueOnce({ data: oldService });
    await click('Land development');
    await enterDeal();
    await runBase();
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(tile('Residual land value').querySelector('strong').textContent).toBe('$724,062');
    expect(text()).not.toContain('$1,013,695');
    expect(text()).not.toContain('From the service.');
    expect(text()).toContain('NO-GO AT THIS PRICE — REPRICE OR PASS');
  });

  test('a service on the current formula is shown as it answered', async () => {
    await act(async () => { root.unmount(); });
    await mount('https://example.test');
    axios.post.mockResolvedValueOnce({ data: { ...oldService, formula_version: 'diamond-underwriting-1.1.0', metrics: { residual_land_value: { value: 724062.14302033, unit: 'USD', formula: 'new' } } } });
    await click('Land development');
    await enterDeal();
    await runBase();
    expect(tile('Residual land value').querySelector('strong').textContent).toBe('$724,062');
    expect(text()).toContain('From the service.');
  });

  test.each([
    ['diamond-underwriting-1.0.0', false], ['diamond-underwriting-1.1.0', true], ['diamond-underwriting-1.2.3', true],
    ['diamond-underwriting-2.0.0', true], ['diamond-underwriting-web-1.2.0', true], ['test', true], [undefined, true],
  ])('service formula %s is current enough for land: %s', (version, current) => {
    expect(landServiceFormulaIsCurrent(version)).toBe(current);
  });
});

describe('nothing changes silently', () => {
  test('typing an address keeps the asset type, the tab and the figures entered, and says what it cleared', async () => {
    await click('Land development');
    // A box that already shows the figure cannot be "entered": typing the same
    // value changes nothing. So what counts as the visitor's is what differs
    // from the land example the tab opened with.
    const typed = Object.entries(deal).filter(([name, value]) => field(name).value !== value);
    expect(typed.length).toBeGreaterThan(10);
    await enterDeal();
    expect(field('propertyType').value).toBe('land');
    await setControl('address', '1');
    await setControl('address', '12 Example Rd, Duluth, GA');
    expect(field('propertyType').value).toBe('land');
    expect(button('Land development').className).toContain('is-active');
    for (const [name, value] of typed) expect(field(name).value).toBe(value);
    // Not entered by the visitor, so cleared: the example values.
    expect(field('market').value).toBe('');
    expect(field('siteAcres').value).toBe('');
    expect(notice().textContent).toContain('The example figures were cleared, because they are not facts about this address.');
    expect(notice().textContent).toContain(`The ${typed.length} figures you entered were kept.`);
    expect(notice().textContent).toContain('The asset type and strategy were not changed.');
    expect(notice().getAttribute('role')).toBe('status');
  });

  test('the cleared example figures can be put back with one press', async () => {
    await setControl('address', '12 Example Rd');
    expect(field('propertyType').value).toBe('multifamily');
    expect(field('purchasePrice').value).toBe('');
    expect(field('annualRent').value).toBe('');
    await click('Put the example figures back');
    expect(field('purchasePrice').value).toBe('3000000');
    expect(field('annualRent').value).toBe('360000');
    expect(field('market').value).toBe('Atlanta, GA');
    expect(field('address').value).toBe('12 Example Rd');
    expect(notice().textContent).toContain('They are illustrations, not facts about this address');
    // Restored figures now count as the visitor's choice: more typing keeps them.
    await setControl('address', '12 Example Rd, Duluth');
    expect(field('purchasePrice').value).toBe('3000000');
    await act(async () => { container.querySelector('button[aria-label="Dismiss this note"]').click(); });
    expect(notice()).toBeNull();
  });

  test('leaving the land tab returns to the asset type in use before it, and says so', async () => {
    await setControl('propertyType', 'condo');
    await click('Land development');
    expect(field('propertyType').value).toBe('land');
    expect(notice().textContent).toBe('Asset type set to Lot / land for the Land development tab. It returns to Condominium when you leave this tab. The example figures you had not changed are now a land example (twelve finished lots on six acres). They are illustrations, not facts about any property.×');
    await click('Rental & commercial');
    expect(field('propertyType').value).toBe('condo');
    expect(notice().textContent).toContain('Asset type set back to Condominium, because Lot / land is analysed only on the Land development tab.');
    await click('Land development');
    await click('Fix & flip');
    expect(field('propertyType').value).toBe('condo');
  });

  test('switching between rental and fix and flip leaves the asset type alone', async () => {
    expect(field('propertyType').value).toBe('multifamily');
    await click('Fix & flip');
    expect(field('propertyType').value).toBe('multifamily');
    expect(notice()).toBeNull();
    await click('Rental & commercial');
    expect(field('propertyType').value).toBe('multifamily');
  });

  test('choosing Lot / land moves to the land tab, and choosing another type there moves back, each with a note', async () => {
    await setControl('purchasePrice', '985000');
    await setControl('propertyType', 'land');
    expect(button('Land development').className).toContain('is-active');
    expect(notice().textContent).toContain('Moved to the Land development tab, because Lot / land is analysed there. Your figures were kept.');
    expect(field('purchasePrice').value).toBe('985000');
    await setControl('propertyType', 'retail');
    expect(button('Rental & commercial').className).toContain('is-active');
    expect(field('propertyType').value).toBe('retail');
    expect(notice().textContent).toContain('Moved to the Rental & commercial tab, because the Land development tab only analyses Lot / land.');
  });
});

describe('flood zone box', () => {
  test('"Not verified" is treated as not verified, with a hint, and never as a hazard zone', async () => {
    await click('Land development');
    await enterDeal({ floodZone: 'Not verified' });
    expect(field('floodZone').closest('label').textContent).toContain('"Not verified" is not a FEMA zone, so the flood zone is treated as not verified.');
    await runBase();
    expect(text()).toContain('The FEMA flood zone is not verified; confirm the designation, base flood elevation, and insurance requirement.');
    expect(text()).not.toContain('Special Flood Hazard Area');
    expect(text()).not.toContain('The entered flood-zone designation requires');
    expect(text()).toContain('FEMA flood zone looked up');
  });

  test('a real hazard zone is named in the warning and the decision', async () => {
    await click('Land development');
    await enterDeal({ floodZone: 'ae' });
    expect(field('floodZone').closest('label').textContent).toContain('Special Flood Hazard Area.');
    await runBase();
    expect(text()).toContain('Flood zone AE is a FEMA Special Flood Hazard Area; floodplain, stormwater, elevation, insurance, and buildable-area review is required.');
  });
});

describe('address lookup', () => {
  const type = async (value) => {
    await setControl('address', value);
    await act(async () => { jest.advanceTimersByTime(400); });
    await act(async () => { await Promise.resolve(); });
  };

  test('without an address provider the page says so and shows no suggestions', async () => {
    jest.useFakeTimers();
    expect(text()).toContain("This site does not look up addresses or public records yet. Type the address for your own reference and enter the property's figures yourself.");
    expect(text()).not.toMatch(/Mapbox|RentCast|credentials/);
    // The service answers a typed "Atl" with market names; they are not addresses.
    axios.get.mockResolvedValue({ data: { provider: 'curated', suggestions: [{ id: 'market-atlanta-ga', label: 'Atlanta, GA', kind: 'market', provider: 'curated' }] } });
    await type('Atl');
    expect(axios.get).toHaveBeenCalled();
    expect(container.querySelector('.studio-property-search .studio-suggestions')).toBeNull();
    expect(text()).toContain('This site does not look up addresses or public records yet.');
  });

  test('with an address provider, suggestions are offered and the note changes', async () => {
    jest.useFakeTimers();
    axios.get.mockResolvedValue({ data: { provider: 'mapbox', suggestions: [{ id: 'a1', label: '12 Example Rd, Duluth, GA 30097', kind: 'address', provider: 'mapbox' }] } });
    await type('12 Exa');
    const options = [...container.querySelectorAll('.studio-property-search .studio-suggestions button')];
    expect(options.map((item) => item.textContent)).toEqual(['12 Example Rd, Duluth, GA 30097Live address result']);
    expect(text()).toContain('Choose a suggestion to load public-record details, then check each one.');
  });

  test('a failed lookup is explained in plain words, without the service\'s setting names', async () => {
    jest.useFakeTimers();
    axios.get.mockResolvedValue({ data: { provider: 'mapbox', suggestions: [{ id: 'a1', label: '12 Example Rd, Duluth, GA 30097', kind: 'address', provider: 'mapbox' }] } });
    await type('12 Exa');
    axios.get.mockRejectedValueOnce({ response: { status: 404, data: { detail: 'Live property lookup requires RENTCAST_API_KEY. Enter property facts manually or configure the provider.' } } });
    await act(async () => { container.querySelector('.studio-property-search .studio-suggestions button').click(); });
    await act(async () => { await Promise.resolve(); });
    expect(text()).toContain("Public-record details are not available for that address. Enter the property's figures yourself.");
    expect(text()).not.toContain('RENTCAST_API_KEY');
  });
});

describe('Monte Carlo on this device', () => {
  test('a land simulation runs every requested iteration and shows the counts', async () => {
    await click('Land development');
    await enterDeal();
    await setControl('mcIterations', '1000');
    await act(async () => { button('Run Monte Carlo').click(); });
    for (let wait = 0; wait < 100 && !container.querySelector('.studio-risk-results article'); wait += 1) {
      await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 20); }); });
    }
    const cards = [...container.querySelectorAll('.studio-risk-results article')];
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card.querySelector('small').textContent).toContain('Requested 1,000 · Completed 1,000 · Excluded 0 · Valid for Development profit 1,000');
      expect(card.textContent).toMatch(/probability above zero \([\d,]+ above zero out of 1,000 valid results\)/);
      expect(card.textContent).not.toContain('requested iterations were run');
    }
    expect(axios.post).not.toHaveBeenCalled();
  });
});

// DE-37. The price, closing costs, hold period and loan terms are one set of
// boxes for all three tabs. They start as a $3,000,000 apartment-building
// example, which read as a land deal was a $2.76 million loss before the
// visitor had typed anything.
describe('the land tab has its own example', () => {
  const shared = Object.keys(LAND_EXAMPLE_SHARED);
  const building = { purchasePrice: '3000000', closingCosts: '75000', initialCapex: '125000', holdMonths: '60', interestOnlyMonths: '0', loanTermYears: '10' };

  test('opening the land tab untouched shows a land deal that works on paper, with the diligence still to do', async () => {
    await click('Land development');
    for (const name of shared) expect(field(name).value).toBe(LAND_EXAMPLE_SHARED[name]);
    expect(field('developmentType').value).toBe('finished_lots');
    expect(field('dispositionStrategy').value).toBe('sell_finished_lots');
    expect(field('units').value).toBe('12');
    expect(field('siteAcres').value).toBe('6');
    expect(notice().textContent).toContain('are now a land example (twelve finished lots on six acres). They are illustrations, not facts about any property.');
    // The page already says, above the form, that prefilled numbers are illustrative.
    expect(text()).toContain('Manual Deal Studio entry. Any prefilled numbers are illustrative');
    await runBase();
    const verdict = container.querySelector('.studio-result__verdict');
    expect(verdict.textContent).toContain('CONDITIONAL GO — VERIFY BEFORE CLOSING');
    expect(verdict.textContent).toContain('At $375,000 the deal is modeled to earn $474,542 (20.81% of exit value), which meets your targets.');
    const kpis = [...container.querySelectorAll('.studio-decision-kpis article')].map((item) => item.textContent);
    expect(kpis[0]).toContain('MAXIMUM LAND PRICE$390,000Exact modeled ceiling $391,945');
    expect(kpis[3]).toContain('0 of 10 diligence items verified');
    expect(text()).not.toContain('THE DEAL LOSES MONEY');
  });

  test('going back to a building tab puts the building example back', async () => {
    await click('Land development');
    await click('Rental & commercial');
    for (const [name, value] of Object.entries(building)) expect(field(name).value).toBe(value);
    expect(notice().textContent).toContain('The example figures you had not changed are the building example again.');
    await click('Land development');
    await click('Fix & flip');
    for (const [name, value] of Object.entries(building)) expect(field(name).value).toBe(value);
  });

  test('a figure the visitor typed is never swapped, in either direction', async () => {
    await setControl('purchasePrice', '985000');
    await setControl('holdMonths', '36');
    await click('Land development');
    expect(field('purchasePrice').value).toBe('985000');
    expect(field('holdMonths').value).toBe('36');
    expect(field('closingCosts').value).toBe('15000');      // untouched, so it followed the tab
    await setControl('closingCosts', '22000');
    await click('Rental & commercial');
    expect(field('purchasePrice').value).toBe('985000');
    expect(field('holdMonths').value).toBe('36');
    expect(field('closingCosts').value).toBe('22000');
    expect(field('initialCapex').value).toBe('125000');     // still an example, so it went back
  });

  test('moving between the two building tabs swaps nothing and says nothing', async () => {
    await click('Fix & flip');
    for (const [name, value] of Object.entries(building)) expect(field(name).value).toBe(value);
    expect(notice()).toBeNull();
  });

  test('figures cleared for an address stay cleared, and the boxes that do change are named', async () => {
    await setControl('address', '12 Example Rd');
    expect(field('purchasePrice').value).toBe('');
    expect(field('holdMonths').value).toBe('60');           // not a fact about an address, so never cleared
    await click('Land development');
    expect(field('purchasePrice').value).toBe('');
    expect(field('closingCosts').value).toBe('');
    expect(field('holdMonths').value).toBe('24');
    expect(notice().textContent).not.toContain('twelve finished lots');
    expect(notice().textContent).toContain('These example figures, which you had not changed, were set for a land deal: hold period, interest-only period, loan term.');
    await click('Rental & commercial');
    expect(field('holdMonths').value).toBe('60');
    expect(notice().textContent).toContain('were set back for a building: hold period, interest-only period, loan term.');
  });

  test('no example figure is an empty box, which is what a cleared figure looks like', () => {
    expect(shared.sort()).toEqual(Object.keys(building).sort());
    Object.values(LAND_EXAMPLE_SHARED).forEach((value) => expect(value).not.toBe(''));
    Object.values(building).forEach((value) => expect(value).not.toBe(''));
  });

  test('exampleSwap changes only boxes that still hold the other example', () => {
    const start = { ...building, strategy: 'rental' };
    expect(exampleSwap(start, 'rental', 'land')).toEqual({ ...LAND_EXAMPLE_SHARED });
    expect(exampleSwap(start, 'rental', 'flip')).toEqual({});
    expect(exampleSwap(start, 'land', 'land')).toEqual({});
    expect(exampleSwap({ ...start, purchasePrice: '1' }, 'rental', 'land').purchasePrice).toBeUndefined();
    // Entered, even though it still equals the example (put back with "Put the example figures back").
    expect(exampleSwap(start, 'rental', 'land', new Set(['purchasePrice'])).purchasePrice).toBeUndefined();
    expect(exampleSwap({ ...LAND_EXAMPLE_SHARED }, 'land', 'rental')).toEqual(building);
    expect(exampleSwap({ ...LAND_EXAMPLE_SHARED, holdMonths: '30' }, 'land', 'flip').holdMonths).toBeUndefined();
  });
});
