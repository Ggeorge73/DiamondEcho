import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import axios from 'axios';
import InvestmentCalculator from './InvestmentCalculator';
import { helpers } from '../components/calculators/testHelpers';
import { Site } from '../App';

// DE-39. The Intelligence page with the real router: three tools, one open at a
// time, chosen by the address.
jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../lib/dealWorkbook', () => ({ downloadDealWorkbook: jest.fn() }));

let container;
let root;
const { type } = helpers(() => container);
const tools = () => [...container.querySelectorAll('.studio-tools a')];
const shell = (label) => container.querySelector(`section[aria-label="${label}"]`);
const dealShell = () => [...container.querySelectorAll('.deal-studio-shell')].find((item) => !item.classList.contains('calc-shell'));
const open = async (label) => { await act(async () => { tools().find((link) => link.textContent.includes(label)).click(); }); };
const mount = async (address) => {
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter initialEntries={[address]}><InvestmentCalculator /></MemoryRouter>); });
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  axios.get.mockResolvedValue({ data: { suggestions: [], provider: 'curated' } });
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

test('the page offers three tools and opens Deal Studio by default', async () => {
  await mount('/investment-calculator');
  expect(tools().map((link) => [link.textContent, link.getAttribute('href'), link.getAttribute('aria-current')])).toEqual([
    ['Deal StudioFor investors', '/investment-calculator', 'page'],
    ['Mortgage simulatorFor buyers', '/mortgage-calculator', null],
    ['Seller net sheetFor sellers', '/seller-net-sheet', null],
  ]);
  expect(container.querySelector('nav.studio-tools').getAttribute('aria-label')).toBe('Intelligence tools');
  expect(dealShell().hidden).toBe(false);
  expect(container.querySelector('h1').textContent).toBe('Underwrite withabsolute clarity.');
  // The buyer and seller tools are not built until they are opened.
  expect(shell('Buyer mortgage simulator')).toBeNull();
  expect(shell('Seller net proceeds calculator')).toBeNull();
});

test.each(['/mortgage-calculator', '/investment-calculator?tool=mortgage'])('the address %s opens the mortgage simulator directly', async (address) => {
  await mount(address);
  expect(shell('Buyer mortgage simulator').hidden).toBe(false);
  expect(dealShell().hidden).toBe(true);
  expect(tools()[1].getAttribute('aria-current')).toBe('page');
  expect(container.querySelector('h1').textContent).toBe('Know the paymentbefore the offer.');
  expect(container.querySelector('.deal-studio-hero__seal').textContent).toBe('AN ESTIMATENOT A LOAN OFFER');
  expect(container.querySelector('.calc-hero strong').textContent).toBe('$2,875');
});

test.each(['/seller-net-sheet', '/investment-calculator?tool=net-proceeds'])('the address %s opens the seller net sheet directly', async (address) => {
  await mount(address);
  expect(shell('Seller net proceeds calculator').hidden).toBe(false);
  expect(dealShell().hidden).toBe(true);
  expect(container.querySelector('h1').textContent).toBe('See what you keepafter closing.');
  expect(container.querySelector('.deal-studio-hero__seal').textContent).toBe('AN ESTIMATENOT A CLOSING STATEMENT');
});

test('an unknown tool opens Deal Studio', async () => {
  await mount('/investment-calculator?tool=lottery');
  expect(dealShell().hidden).toBe(false);
  expect(tools()[0].getAttribute('aria-current')).toBe('page');
});

test('moving between the tools keeps what was typed in each of them', async () => {
  await mount('/investment-calculator');
  const dealPrice = () => dealShell().querySelector('[name="purchasePrice"]');
  const setDeal = async (value) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    await act(async () => { setValue.call(dealPrice(), value); dealPrice().dispatchEvent(new Event('input', { bubbles: true })); });
  };
  await setDeal('1234567');

  await open('Mortgage simulator');
  expect(shell('Buyer mortgage simulator').hidden).toBe(false);
  expect(dealShell().hidden).toBe(true);
  await type('price', '610000');
  expect(container.querySelector('.calc-hero strong').textContent).toBe('$3,844');

  await open('Seller net sheet');
  expect(shell('Seller net proceeds calculator').hidden).toBe(false);
  expect(shell('Buyer mortgage simulator').hidden).toBe(true);
  await type('salePrice', '500000');

  await open('Mortgage simulator');
  expect(shell('Buyer mortgage simulator').querySelector('[name="price"]').value).toBe('610000');
  await open('Seller net sheet');
  expect(shell('Seller net proceeds calculator').querySelector('[name="salePrice"]').value).toBe('500000');
  await open('Deal Studio');
  expect(dealShell().hidden).toBe(false);
  expect(dealPrice().value).toBe('1234567');
});

test('only the open tool can be reached; the others are hidden, not just out of sight', async () => {
  await mount('/mortgage-calculator');
  await open('Seller net sheet');
  const hidden = [...container.querySelectorAll('.deal-studio-shell')].filter((item) => item.hidden);
  expect(hidden).toHaveLength(2);
  expect(container.querySelectorAll('.deal-studio-shell:not([hidden])')).toHaveLength(1);
});

test('the stylesheet hides a tool that is not open', () => {
  const fs = require('fs');
  const path = require('path');
  const css = fs.readFileSync(path.resolve(__dirname, '../components/calculators/calculators.css'), 'utf8');
  // .deal-studio-shell sets display: grid, which would otherwise beat the hidden attribute.
  expect(css).toContain('.deal-studio-shell[hidden] { display: none; }');
});

// The three tools are three addresses of one page (App.js). Through the site's
// own routes, as a visitor meets them.
describe('through the site\u2019s own routes', () => {
  let where;
  const Probe = () => { const location = useLocation(); where = `${location.pathname}${location.search}`; return null; };
  const originalObserver = global.IntersectionObserver;
  const mountSite = async (address) => {
    root = createRoot(container);
    await act(async () => { root.render(<MemoryRouter initialEntries={[address]}><Site /><Probe /></MemoryRouter>); });
  };
  beforeEach(() => {
    window.scrollTo = jest.fn();
    global.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  });
  afterEach(() => { global.IntersectionObserver = originalObserver; });

  test('moving between the three addresses keeps what was typed and does not jump to the top', async () => {
    await mountSite('/investment-calculator');
    const dealPrice = () => dealShell().querySelector('[name="purchasePrice"]');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    await act(async () => { setValue.call(dealPrice(), '1234567'); dealPrice().dispatchEvent(new Event('input', { bubbles: true })); });
    window.scrollTo.mockClear();

    await open('Mortgage simulator');
    expect(where).toBe('/mortgage-calculator');
    expect(document.title).toBe('Mortgage Calculator for Georgia Home Buyers | DiamondEcho');
    await type('price', '610000');
    await open('Seller net sheet');
    expect(where).toBe('/seller-net-sheet');
    expect(document.title).toBe('Georgia Seller Net Sheet: Estimate Sale Proceeds | DiamondEcho');
    await type('salePrice', '500000');
    await open('Deal Studio');
    expect(where).toBe('/investment-calculator');
    expect(dealPrice().value).toBe('1234567');
    await open('Mortgage simulator');
    expect(shell('Buyer mortgage simulator').querySelector('[name="price"]').value).toBe('610000');
    await open('Seller net sheet');
    expect(shell('Seller net proceeds calculator').querySelector('[name="salePrice"]').value).toBe('500000');
    // A tab change, not a new page.
    expect(window.scrollTo).not.toHaveBeenCalled();
    // The header shows the visitor is still in "Intelligence".
    expect(container.querySelector('.mf-nav__links a[aria-current="page"]').textContent).toBe('Intelligence');
  });

  test.each([
    ['/investment-calculator?tool=mortgage', '/mortgage-calculator'],
    ['/investment-calculator?tool=mortgage&price=525000&taxes=6100&hoa=140', '/mortgage-calculator?price=525000&taxes=6100&hoa=140'],
    ['/investment-calculator?tool=net-proceeds', '/seller-net-sheet'],
    ['/investment-calculator?tool=deal', '/investment-calculator'],
  ])('an older link %s ends on the tool\u2019s own address %s', async (from, to) => {
    await mountSite(from);
    expect(where).toBe(to);
  });

  test('an older link carries its figures to the mortgage simulator', async () => {
    await mountSite('/investment-calculator?tool=mortgage&price=525000&taxes=6100&hoa=140');
    expect(shell('Buyer mortgage simulator').hidden).toBe(false);
    expect(shell('Buyer mortgage simulator').querySelector('[name="price"]').value).toBe('525000');
    expect(container.querySelector('h1').textContent).toBe('Know the paymentbefore the offer.');
  });

  test('the footer links to each calculator at its own address', async () => {
    await mountSite('/about');
    const links = Object.fromEntries([...container.querySelectorAll('footer a')].map((link) => [link.textContent, link.getAttribute('href')]));
    expect(links['Mortgage simulator']).toBe('/mortgage-calculator');
    expect(links['Seller net sheet']).toBe('/seller-net-sheet');
    expect(links['Deal studio']).toBe('/investment-calculator');
  });
});
