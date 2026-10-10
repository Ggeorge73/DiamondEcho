import { prerenderMatches } from './prerendered';

const saved = (path, { empty = false } = {}) => {
  const container = document.createElement('div');
  if (path) container.setAttribute('data-prerendered', path);
  if (!empty) container.innerHTML = '<div class="App"><h1>Saved</h1></div>';
  return container;
};
const at = (pathname, search = '') => ({ pathname, search });

test('the saved page is the one asked for at its own address', () => {
  expect(prerenderMatches(saved('/about'), at('/about'))).toBe(true);
  expect(prerenderMatches(saved('/'), at('/'))).toBe(true);
  expect(prerenderMatches(saved('/about'), at('/about/'))).toBe(true);
});

test('it is not when there is no saved page', () => {
  // The development server and 404.html: an empty root with no marker.
  expect(prerenderMatches(saved(null, { empty: true }), at('/about'))).toBe(false);
  expect(prerenderMatches(saved('/about', { empty: true }), at('/about'))).toBe(false);
  expect(prerenderMatches(null, at('/about'))).toBe(false);
});

test('it is not when the address is another page', () => {
  // An old listing link is answered with the search page's HTML.
  expect(prerenderMatches(saved('/search'), at('/property/123'))).toBe(false);
  expect(prerenderMatches(saved('/'), at('/about'))).toBe(false);
});

test('it is not when the address carries something that changes the page', () => {
  expect(prerenderMatches(saved('/inquire'), at('/inquire', '?type=seller'))).toBe(false);
  expect(prerenderMatches(saved('/search'), at('/search', '?status=rent'))).toBe(false);
  expect(prerenderMatches(saved('/search'), at('/search', '?q=Alpharetta'))).toBe(false);
  expect(prerenderMatches(saved('/investment-calculator'), at('/investment-calculator', '?tool=mortgage'))).toBe(false);
  expect(prerenderMatches(saved('/mortgage-calculator'), at('/mortgage-calculator', '?price=525000'))).toBe(false);
  expect(prerenderMatches(saved('/investment-calculator'), at('/investment-calculator', '?listing=1'))).toBe(false);
  // One tag that changes nothing does not excuse one that does.
  expect(prerenderMatches(saved('/inquire'), at('/inquire', '?utm_source=mail&type=tour'))).toBe(false);
});

test('campaign tags change nothing on the page, so they are let through', () => {
  expect(prerenderMatches(saved('/about'), at('/about', '?utm_source=newsletter&utm_medium=email&utm_campaign=fall_2026'))).toBe(true);
  expect(prerenderMatches(saved('/'), at('/', '?gclid=abc123'))).toBe(true);
  expect(prerenderMatches(saved('/'), at('/', '?fbclid=x&msclkid=y&gbraid=1&wbraid=2&dclid=3'))).toBe(true);
  expect(prerenderMatches(saved('/'), at('/', '?UTM_Source=X'))).toBe(true);
  expect(prerenderMatches(saved('/'), at('/', '?utm_source'))).toBe(true);
  // A name that only starts like a tag is not one.
  expect(prerenderMatches(saved('/'), at('/', '?gclidx=1'))).toBe(false);
});

test('the function stands alone, because the build writes it into each page as text', () => {
  const source = prerenderMatches.toString();
  // Run from its text alone, it gives the same answers.
  // eslint-disable-next-line no-new-func
  const copy = new Function(`return (${source});`)();
  expect(copy(saved('/about'), at('/about', '?utm_source=a'))).toBe(true);
  expect(copy(saved('/about'), at('/about', '?type=seller'))).toBe(false);
  expect(copy(saved('/search'), at('/property/9'))).toBe(false);
});
