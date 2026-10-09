import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import Home from './Home';
import Agents from './Agents';
import { Privacy, Terms } from './Policies';
import Footer from '../components/Footer';
import { assistantAvailable } from '../lib/assistant';

// DE-20: a build with no service must not offer the assistant anywhere, and
// must not describe it. A build with a service offers it everywhere it did.

let container;
let root;
let originalObserver;
const savedBackend = process.env.REACT_APP_BACKEND_URL;

const render = async (element) => {
  await act(async () => root.render(<MemoryRouter>{element}</MemoryRouter>));
};
const withService = () => { process.env.REACT_APP_BACKEND_URL = 'https://api.example.test'; };
const withoutService = () => { delete process.env.REACT_APP_BACKEND_URL; };

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  originalObserver = global.IntersectionObserver;
  global.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  global.IntersectionObserver = originalObserver;
  if (savedBackend === undefined) delete process.env.REACT_APP_BACKEND_URL;
  else process.env.REACT_APP_BACKEND_URL = savedBackend;
});

test('availability follows the service address', () => {
  withoutService();
  expect(assistantAvailable()).toBe(false);
  process.env.REACT_APP_BACKEND_URL = '  ';
  expect(assistantAvailable()).toBe(false);
  withService();
  expect(assistantAvailable()).toBe(true);
});

const pagesWithoutAssistant = [
  ['home page', <Home />],
  ['advisory page', <Agents />],
  ['footer', <Footer />],
  ['privacy page', <Privacy />],
  ['terms page', <Terms />],
];

test.each(pagesWithoutAssistant)('%s does not mention or offer the assistant with no service', async (_name, element) => {
  withoutService();
  await render(element);
  expect(container.textContent).not.toMatch(/concierge/i);
  expect(container.textContent).not.toMatch(/assistant/i);
  expect(container.textContent).not.toContain('ask property questions');
});

test('home page shows three numbered tiles with no service and four with one', async () => {
  withoutService();
  await render(<Home />);
  let tiles = [...container.querySelectorAll('.mf-portal__tile')];
  expect(tiles.map((tile) => tile.querySelector('h3').textContent)).toEqual(['Search Georgia MLS', 'Deal Studio', 'Advisory']);
  expect(tiles.map((tile) => tile.querySelector('header span').textContent)).toEqual(['01', '02', '03']);
  expect(container.querySelector('.mf-portal__grid').className).toBe('mf-portal__grid mf-portal__grid--three');
  expect(container.querySelector('.mf-portal__head').textContent).toContain('Browse residences and model a potential deal. See the available paths');

  await act(async () => root.unmount());
  withService();
  root = createRoot(container);
  await render(<Home />);
  tiles = [...container.querySelectorAll('.mf-portal__tile')];
  expect(tiles.map((tile) => tile.querySelector('h3').textContent)).toEqual(['Search Georgia MLS', 'Deal Studio', 'Ask the concierge', 'Advisory']);
  expect(tiles.map((tile) => tile.querySelector('header span').textContent)).toEqual(['01', '02', '03', '04']);
  expect(container.querySelector('.mf-portal__grid').className).toBe('mf-portal__grid');
  expect(container.querySelector('.mf-portal__head').textContent).toContain('ask property questions online. See the available paths');
});

test('the home concierge tile asks the assistant to open', async () => {
  withService();
  await render(<Home />);
  const opened = vi.fn();
  window.addEventListener('open-diamond-assistant', opened);
  const tile = [...container.querySelectorAll('.mf-portal__tile')].find((item) => item.textContent.includes('Ask the concierge'));
  await act(async () => tile.click());
  window.removeEventListener('open-diamond-assistant', opened);
  expect(opened).toHaveBeenCalledTimes(1);
});

test('advisory page keeps one primary action either way', async () => {
  const actions = () => [...container.querySelectorAll('.mf-contact__actions button')];
  withoutService();
  await render(<Agents />);
  expect(actions().map((button) => button.textContent.trim())).toEqual(['Ask about buying', 'Discuss selling']);
  expect(actions().map((button) => button.className)).toEqual(['mf-btn mf-btn--solid', 'mf-btn']);

  await act(async () => root.unmount());
  withService();
  root = createRoot(container);
  await render(<Agents />);
  expect(actions().map((button) => button.textContent.trim())).toEqual(['Ask the concierge', 'Ask about buying', 'Discuss selling']);
  expect(actions().map((button) => button.className)).toEqual(['mf-btn mf-btn--solid', 'mf-btn', 'mf-btn']);
});

test('footer offers the concierge only with a service', async () => {
  withService();
  await render(<Footer />);
  const opened = vi.fn();
  window.addEventListener('open-diamond-assistant', opened);
  const link = [...container.querySelectorAll('.mf-footer__col button')].find((button) => button.textContent.includes('Ask the concierge'));
  await act(async () => link.click());
  window.removeEventListener('open-diamond-assistant', opened);
  expect(opened).toHaveBeenCalledTimes(1);
});

test('policy pages describe the assistant only where it is offered', async () => {
  withService();
  await render(<Privacy />);
  expect(container.textContent).toContain('Questions you type into the assistant');
  await act(async () => root.unmount());
  root = createRoot(container);
  await render(<Terms />);
  expect(container.textContent).toContain('The Ask DiamondEcho assistant gives general real estate information');
});
