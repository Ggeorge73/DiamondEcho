import { clearRetiredTracking } from './retiredTracking';

const cookieNames = () => document.cookie.split(';').map((part) => part.split('=')[0].trim()).filter(Boolean);

afterEach(() => {
  cookieNames().forEach((name) => { document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`; });
  window.localStorage.clear();
});

test('removes the leftover analytics cookie and storage entry and nothing else', () => {
  document.cookie = 'ph_phc_exampleKey_posthog=%7B%22distinct_id%22%3A%22abc%22%7D; path=/';
  document.cookie = 'unrelated=keep; path=/';
  window.localStorage.setItem('ph_phc_exampleKey_posthog', '{}');
  window.localStorage.setItem('unrelated', 'keep');

  expect(clearRetiredTracking()).toBe(2);

  expect(cookieNames()).toEqual(['unrelated']);
  expect(window.localStorage.getItem('ph_phc_exampleKey_posthog')).toBeNull();
  expect(window.localStorage.getItem('unrelated')).toBe('keep');
});

test('does nothing when no leftover exists', () => {
  document.cookie = 'unrelated=keep; path=/';
  expect(clearRetiredTracking()).toBe(0);
  expect(cookieNames()).toEqual(['unrelated']);
});

test('expires the cookie on the host and on each parent domain', () => {
  const written = [];
  const doc = {
    get cookie() { return 'ph_phc_exampleKey_posthog=1'; },
    set cookie(value) { written.push(value); },
  };
  clearRetiredTracking(doc, 'abc123.diamondecho.pages.dev', {});
  const domains = written.map((value) => (value.match(/domain=([^;]+)/) || [])[1] || '');
  expect(domains).toEqual(['', '.abc123.diamondecho.pages.dev', '.diamondecho.pages.dev', '.pages.dev']);
  written.forEach((value) => expect(value).toContain('expires=Thu, 01 Jan 1970'));
});

test('survives blocked cookies and unavailable storage', () => {
  const doc = { get cookie() { throw new Error('blocked'); } };
  const storage = new Proxy({}, { ownKeys() { throw new Error('unavailable'); } });
  expect(clearRetiredTracking(doc, 'example.test', storage)).toBe(0);
});
