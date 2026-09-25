const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));

function page(config, fetch) {
  const dom = new JSDOM(html, { url: 'https://staff.diamondecho.test/', runScripts: 'outside-only' });
  dom.window.DIAMOND_ECHO_STAFF_CONFIG = config;
  dom.window.fetch = fetch;
  dom.window.eval(app);
  return dom.window;
}

function submit(window, key) {
  window.document.getElementById('credential').value = key;
  window.document.getElementById('signin-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}

test('disabled deployment fails closed without calling an API', () => {
  let calls = 0;
  const window = page({ enabled: false, apiBase: 'https://api.example.invalid' }, () => { calls++; });
  assert.equal(window.document.getElementById('signin-button').disabled, true);
  assert.match(window.document.getElementById('alert').textContent, /disabled/);
  assert.equal(window.document.getElementById('queue-section').hidden, true);
  assert.equal(calls, 0);
  window.close();
});

test('denied key reveals no visitor data and clears the input', async () => {
  const window = page({ enabled: true, apiBase: 'https://api.diamondecho.test' }, async () => ({ ok: false, status: 401 }));
  submit(window, 'test-key');
  await tick();
  assert.match(window.document.getElementById('alert').textContent, /Access denied/);
  assert.equal(window.document.getElementById('credential').value, '');
  assert.equal(window.document.getElementById('queue-section').hidden, true);
  assert.equal(window.document.getElementById('inquiries').textContent, '');
  window.close();
});

test('authenticated queue acknowledges and sign-out removes PII', async () => {
  const requests = [];
  const window = page({ enabled: true, apiBase: 'https://api.diamondecho.test' }, async (url, options) => {
    requests.push({ url, options });
    if (options?.method === 'PATCH') return { ok: true, json: async () => ({ request_id: 'req-1', status: 'acknowledged' }) };
    return { ok: true, json: async () => ({ items: [{ request_id: 'req-1', kind: 'buyer', status: 'queued', full_name: 'Private Buyer', email: 'private@example.com' }] }) };
  });
  assert.doesNotMatch(window.document.body.textContent, /Private Buyer/);
  submit(window, 'test-key');
  await tick();
  assert.match(window.document.getElementById('inquiries').textContent, /Private Buyer/);
  assert.equal(window.document.getElementById('credential').value, '');
  assert.equal(requests[0].url, 'https://api.diamondecho.test/api/v1/inquiries/staff?limit=50');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-key');
  window.document.querySelector('.inquiry button').click();
  await tick();
  assert.equal(requests[1].url, 'https://api.diamondecho.test/api/v1/inquiries/staff/req-1/acknowledge');
  assert.equal(window.document.querySelector('.inquiry button').disabled, true);
  assert.match(window.document.getElementById('notice').textContent, /acknowledged/);
  window.document.getElementById('signout-button').click();
  assert.doesNotMatch(window.document.body.textContent, /Private Buyer|private@example.com/);
  assert.equal(window.document.getElementById('queue-section').hidden, true);
  window.close();
});

test('staff HTML loads only local scripts and contains no recorder', () => {
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(scripts, ['./config.js', './app.js']);
  assert.doesNotMatch(html, /rrweb|posthog|emergent-main|https:\/\/[^" ]+\.js/i);
  assert.doesNotMatch(app, /localStorage|sessionStorage|console\.log/);
});
