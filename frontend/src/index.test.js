/**
 * The first lines the browser runs (src/index.js): take the saved page over as
 * it stands when it is the page the address asks for, and draw the page from
 * nothing in every other case.
 */
jest.mock('axios', () => {
  const pending = () => new Promise(() => {});
  return { get: jest.fn(pending), post: jest.fn(pending) };
});

const originalObserver = global.IntersectionObserver;
const originalFetch = global.fetch;
let warnings;

// What the build writes for a page: the app's own HTML, with fields, buttons and labels held inert.
const savedPage = (address) => {
  let html;
  jest.isolateModules(() => { html = require('./prerender').renderPage(address); });
  return html.replace(/<(input|select|textarea|button|label)(?=[\s>])/g, '<$1 inert=""');
};
const start = async (address, { saved, marker } = {}) => {
  window.history.pushState({}, '', address);
  document.body.innerHTML = '<div id="root"></div>';
  const container = document.getElementById('root');
  if (marker) container.setAttribute('data-prerendered', marker);
  if (saved) container.innerHTML = saved;
  const before = container.querySelector('h1');
  // index.js is loaded afresh each time, and with it its own copy of React:
  // the waiting has to be done by that copy.
  let started;
  jest.isolateModules(() => {
    const { act } = require('react');
    started = act(async () => { require('./index'); });
  });
  await started;
  return { container, before };
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = jest.fn();
  global.fetch = jest.fn(() => new Promise(() => {}));
  global.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  warnings = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnings.mockRestore();
  document.body.innerHTML = '';
  global.IntersectionObserver = originalObserver;
  global.fetch = originalFetch;
  window.history.pushState({}, '', '/');
});

test('the saved page for this address is taken over as it stands, and its fields are released', async () => {
  const saved = savedPage('/mortgage-calculator');
  expect(saved).toMatch(/<input inert=""/);
  expect(saved).toMatch(/<label inert=""/);
  const { container, before } = await start('/mortgage-calculator', { saved, marker: '/mortgage-calculator' });
  expect(before).not.toBeNull();
  // The same heading element: nothing was redrawn.
  expect(container.querySelector('h1')).toBe(before);
  expect(container.querySelectorAll('[inert]')).toHaveLength(0);
  expect(warnings).not.toHaveBeenCalled();
});

test('campaign tags do not stop the page being taken over', async () => {
  const { container, before } = await start('/about?utm_source=mail&gclid=1', { saved: savedPage('/about'), marker: '/about' });
  expect(container.querySelector('h1')).toBe(before);
  expect(container.querySelectorAll('[inert]')).toHaveLength(0);
});

test('an address that changes the page is drawn from nothing, with nothing left inert', async () => {
  // /inquire?type=seller is answered with the saved buyer request.
  const { container, before } = await start('/inquire?type=seller', { saved: savedPage('/inquire'), marker: '/inquire' });
  expect(container.querySelector('h1')).not.toBe(before);
  expect(container.querySelector('h1').textContent).toMatch(/[Ss]ell/);
  expect(container.querySelectorAll('[inert]')).toHaveLength(0);
  expect(warnings).not.toHaveBeenCalled();
});

test('the saved search page answering an old listing link is replaced, and the app moves on to the search', async () => {
  const { container } = await start('/property/123', { saved: savedPage('/search'), marker: '/search' });
  expect(window.location.pathname).toBe('/search');
  expect(container.querySelectorAll('[inert]')).toHaveLength(0);
  expect(container.querySelectorAll('iframe[title="Georgia MLS property search"]')).toHaveLength(1);
});

test('an empty root, as on the development server and on 404.html, is drawn as before', async () => {
  const { container } = await start('/no-such-page');
  expect(container.querySelector('h1').textContent).toContain('We can’t find');
  expect(warnings).not.toHaveBeenCalled();
});
