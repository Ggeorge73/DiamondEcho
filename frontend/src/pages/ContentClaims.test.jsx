import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import About from './About';
import Agents from './Agents';
import Home from './Home';

let container;
let root;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test('advisory page offers real paths without fictional people or listing counts', async () => {
  await act(async () => root.render(<MemoryRouter><Agents /></MemoryRouter>));
  expect(container.textContent).toContain('Individual advisor profiles will appear only after');
  expect(container.textContent).toContain('Explore properties');
  expect(container.textContent).toContain('Start a conversation');
  expect(container.querySelectorAll('.mf-advisor')).toHaveLength(3);
  expect(container.querySelector('a[href^="tel:"]')).toBeNull();
  expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
  expect(container.textContent).not.toContain('active listings');
  expect(container.textContent).not.toContain('Active mandates');
});

test('about page makes no unsupported transaction or experience claims', async () => {
  await act(async () => root.render(<MemoryRouter><About /></MemoryRouter>));
  for (const claim of ['2,500+', '1,800+', '15+', '450+', 'Clients represented', 'Residences sold']) {
    expect(container.textContent).not.toContain(claim);
  }
  expect(container.textContent).toContain('Georgia MLS property search');
  expect(container.querySelector('img[alt="Illustrative residential architecture"]')).not.toBeNull();
});

// DE-17, second pass. The site's own Terms say Deal Studio "produces estimates
// from the figures you enter" and that results are not advice or a guarantee.
// The marketing copy has to say the same thing, and it may not claim coverage
// areas, advisory services or market statistics that nobody has approved.
describe('claims that need the owner’s approval stay off the site', () => {
  const fs = require('fs');
  const path = require('path');
  const srcDir = path.resolve(__dirname, '..');
  const sources = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.jsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
  const published = sources(srcDir).map((file) => ({ file: path.relative(srcDir, file), text: fs.readFileSync(file, 'utf8') }));

  test.each([
    // Where the business operates: a Georgia licensee's site claimed national reach.
    ["k: 'Coverage'", 'a coverage area'],
    ["v: 'National'", 'national coverage'],
    ['Sunbelt', 'a coverage area'],
    // Services nobody has confirmed the business offers.
    ['entitlement guidance', 'an advisory service'],
    ['construction finance', 'a financing service'],
    ['under one roof', 'a bundle of services'],
    ['clear-eyed views on repositioning risk', 'an advisory service'],
    // Market statistics with no source.
    ['Typical hold', 'an unsourced statistic'],
    ["k: 'Cycle'", 'an unsourced statistic'],
    // Statements the Terms contradict.
    ['real rent rolls', 'underwriting on documents the site never sees'],
    ['downside is known', 'certainty about an outcome'],
    ['you can act on', 'a result presented as advice'],
    // Things this build does not do.
    ['Address-enriched', 'property-data lookup, which needs a service the launch build does not have'],
    ['neighborhoods, and negotiation', 'assistant topics the assistant does not cover'],
  ])('no page says %j (%s)', (phrase) => {
    const found = published.filter((item) => item.text.includes(phrase)).map((item) => item.file);
    expect(found).toEqual([]);
  });

  test('the scan reads the pages it is meant to protect', () => {
    const files = published.map((item) => item.file);
    expect(files).toEqual(expect.arrayContaining([
      path.join('pages', 'Home.jsx'), path.join('pages', 'About.jsx'), path.join('pages', 'Agents.jsx'),
      path.join('pages', 'InvestmentCalculator.jsx'), path.join('components', 'Footer.jsx'),
    ]));
  });
});

describe('home page investment items describe Deal Studio and open it', () => {
  let location;
  const Probe = () => { location = useLocation(); return null; };
  let originalObserver;
  beforeEach(() => {
    originalObserver = global.IntersectionObserver;
    global.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  });
  afterEach(() => { global.IntersectionObserver = originalObserver; });
  const click = async (element) => {
    await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
  };
  const openInvestments = async () => {
    await act(async () => root.render(<MemoryRouter initialEntries={['/']}><Home /><Probe /></MemoryRouter>));
    await click([...container.querySelectorAll('.mf-explorer__tabs button')].find((tab) => tab.textContent === 'Investments'));
    return [...container.querySelectorAll('.mf-accordion__item')];
  };

  test('each item names a Deal Studio strategy and says where it is modeled', async () => {
    const items = await openInvestments();
    expect(items.map((item) => item.querySelector('.mf-accordion__head strong').textContent))
      .toEqual(['Multifamily', 'Fix & Flip', 'Commercial', 'New Development']);
    for (const item of items) {
      const facts = [...item.querySelectorAll('dl > div')].map((row) => `${row.querySelector('dt').textContent}: ${row.querySelector('dd').textContent}`);
      expect(facts).toHaveLength(2);
      expect(facts[0]).toMatch(/^Strategy: (Rental & commercial|Fix & flip|Land development)$/);
      expect(facts[1]).toBe('Modeled in: Deal Studio');
      // The words that make it a description of a tool the visitor drives.
      expect(item.querySelector('.mf-accordion__content p').textContent).toMatch(/you enter|your own|so you can see/);
    }
  });

  test.each([0, 1, 2, 3])('item %i opens Deal Studio, not a page that offers no such service', async (index) => {
    const items = await openInvestments();
    await click(items[index].querySelector('.text-link'));
    expect(location.pathname).toBe('/investment-calculator');
  });

  test('the Deal Studio summary says its results are estimates, not advice', async () => {
    await act(async () => root.render(<MemoryRouter><Home /></MemoryRouter>));
    const text = container.querySelector('#intelligence').textContent;
    expect(text).toContain('for you to review');
    expect(text).toContain('Results are estimates from the figures you enter, not advice.');
  });
});

describe('strategies named on the home page exist in Deal Studio', () => {
  const fs = require('fs');
  const path = require('path');
  const studio = fs.readFileSync(path.resolve(__dirname, 'InvestmentCalculator.jsx'), 'utf8');
  test.each(['Rental & commercial', 'Fix & flip', 'Land development'])('%s is a Deal Studio strategy button', (label) => {
    expect(studio).toContain(`${label}</button>`);
  });
  test.each(['Multifamily', 'Office', 'Retail', 'Industrial', 'Mixed-use', 'Hospitality'])('%s is a Deal Studio asset type', (label) => {
    expect(studio).toContain(`>${label}</option>`);
  });
  test('Deal Studio says its analysis comes from the figures the visitor enters', () => {
    expect(studio).toContain('from the figures you enter.</p>');
  });
});
