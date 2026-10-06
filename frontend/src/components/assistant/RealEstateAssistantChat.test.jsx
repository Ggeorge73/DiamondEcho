import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import axios from 'axios';
import RealEstateAssistant, { formatReviewed, handoffFor, isSitePath } from './RealEstateAssistant';

// DE-20: what the panel does with an answer. The service is stood in for; its
// own answers are tested in backend/tests/test_assistant_conversation.py.
jest.mock('axios', () => ({ post: jest.fn() }));

const savedBackend = process.env.REACT_APP_BACKEND_URL;
let container;
let root;

const Where = () => {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
};
const where = () => container.querySelector('[data-testid="where"]').textContent;
const panel = () => container.querySelector('[aria-label="DiamondEcho real estate assistant"]');
const launcher = () => container.querySelector('button[aria-label="Open DiamondEcho assistant"]');
const bubbles = () => [...panel().querySelectorAll('article')];
const lastBubble = () => bubbles()[bubbles().length - 1];
const byText = (scope, selector, text) => [...scope.querySelectorAll(selector)].find((node) => node.textContent.trim() === text);
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

const type = async (text) => {
  const box = panel().querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  await act(async () => { setter.call(box, text); box.dispatchEvent(new Event('input', { bubbles: true })); });
};
const send = async (text) => {
  await type(text);
  await act(async () => { panel().querySelector('button[aria-label="Send message"]').click(); });
  await settle();
};

const answer = (extra = {}) => ({
  data: {
    response_id: 'r-1',
    answer: 'A seller plan should cover pricing evidence [1].',
    citations: [{ id: 'irs-523', title: 'Publication 523: Selling Your Home', publisher: 'Internal Revenue Service', url: 'https://www.irs.gov/publications/p523', jurisdiction: 'US federal', reviewed_at: '2026-07-09' }],
    disclaimers: ['Educational information only.'],
    follow_up_questions: ['Is this a primary home, rental, or commercial property, and where is it located?'],
    as_of: '2026-10-06',
    jurisdiction: { country: 'US', state: null, locality: null },
    risk_level: 'transaction_specific',
    requires_professional: false,
    handoff_recommended: false,
    links: [],
    handoff: null,
    ...extra,
  },
});

beforeEach(async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  process.env.REACT_APP_BACKEND_URL = 'https://api.example.test';
  axios.post.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/about']}><Where /><RealEstateAssistant /></MemoryRouter>
  ));
  await act(async () => launcher().click());
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  if (savedBackend === undefined) delete process.env.REACT_APP_BACKEND_URL;
  else process.env.REACT_APP_BACKEND_URL = savedBackend;
});

test('a source shows its own review date, not the day of the conversation', async () => {
  axios.post.mockResolvedValue(answer());
  await send('How do I plan to sell my house?');
  const text = lastBubble().textContent;
  expect(text).toContain('Internal Revenue Service · reviewed Jul 9, 2026');
  expect(text).not.toContain('2026-10-06');
  expect(text).not.toContain('Oct 6, 2026');
  const source = lastBubble().querySelector('a[href="https://www.irs.gov/publications/p523"]');
  expect(source.getAttribute('target')).toBe('_blank');
  expect(source.textContent).toContain('[1] Publication 523: Selling Your Home');
});

test('formatReviewed reads a calendar date and gives nothing for anything else', () => {
  expect(formatReviewed('2026-07-09')).toBe('Jul 9, 2026');
  expect(formatReviewed('2026-10-06')).toBe('Oct 6, 2026');
  expect(formatReviewed('2026-01-01')).toBe('Jan 1, 2026');
  expect(formatReviewed('2026-13-01')).toBe('');
  expect(formatReviewed('July 9')).toBe('');
  expect(formatReviewed(undefined)).toBe('');
});

test('a source with no review date shows the publisher alone', async () => {
  const reply = answer();
  delete reply.data.citations[0].reviewed_at;
  axios.post.mockResolvedValue(reply);
  await send('How do I plan to sell my house?');
  expect(lastBubble().textContent).toContain('Internal Revenue Service');
  expect(lastBubble().textContent).not.toContain('reviewed');
});

test('the questions the assistant asks are shown', async () => {
  axios.post.mockResolvedValue(answer());
  await send('How do I plan to sell my house?');
  expect(lastBubble().textContent).toContain('To go further, tell me');
  expect(byText(lastBubble(), 'li', 'Is this a primary home, rental, or commercial property, and where is it located?')).toBeTruthy();
});

test('the reply is sent with the conversation so far, and a state named in the chat is kept', async () => {
  axios.post
    .mockResolvedValueOnce(answer())
    .mockResolvedValueOnce(answer({ answer: 'Thanks. For a primary home in Georgia…', jurisdiction: { country: 'US', state: 'GA', locality: null }, follow_up_questions: [] }))
    .mockResolvedValueOnce(answer({ answer: 'Closing costs are…', follow_up_questions: [] }));
  await send('How do I plan to sell my house?');
  await send('A primary home in Atlanta, Georgia');
  const [url, body] = axios.post.mock.calls[1];
  expect(url).toBe('https://api.example.test/api/assistant/chat');
  expect(body.message).toBe('A primary home in Atlanta, Georgia');
  expect(body.history).toEqual([
    { role: 'user', content: 'How do I plan to sell my house?' },
    { role: 'assistant', content: 'A seller plan should cover pricing evidence [1].' },
    { role: 'user', content: 'A primary home in Atlanta, Georgia' },
  ]);
  expect(body.jurisdiction).toEqual({ country: 'US', state: null });
  // The state the service read from the chat now fills the state box…
  expect(panel().querySelector('#assistant-state').value).toBe('GA');
  // …and goes with the next question.
  await send('What are closing costs?');
  expect(axios.post.mock.calls[2][1].jurisdiction).toEqual({ country: 'US', state: 'GA' });
});

test('a state the visitor typed is not replaced by one from the service', async () => {
  const box = panel().querySelector('#assistant-state');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(box, 'NY'); box.dispatchEvent(new Event('input', { bubbles: true })); });
  axios.post.mockResolvedValue(answer({ jurisdiction: { country: 'US', state: 'GA', locality: null } }));
  await send('How do I plan to sell my house?');
  expect(panel().querySelector('#assistant-state').value).toBe('NY');
});

test('links to this site are offered, open the page and close the panel', async () => {
  axios.post.mockResolvedValue(answer({ links: [{ label: 'Open the Seller Net Sheet', path: '/investment-calculator?tool=net-proceeds' }] }));
  await send('How do I plan to sell my house?');
  const link = byText(lastBubble(), 'a', 'Open the Seller Net Sheet');
  expect(link.getAttribute('href')).toBe('/investment-calculator?tool=net-proceeds');
  await act(async () => link.click());
  expect(where()).toBe('/investment-calculator?tool=net-proceeds');
  expect(panel()).toBeNull();
});

test('a link that leaves this site is not shown', async () => {
  axios.post.mockResolvedValue(answer({ links: [
    { label: 'Elsewhere', path: 'https://example.com/' },
    { label: 'Protocol-relative', path: '//example.com/' },
    { label: 'Script', path: 'javascript:alert(1)' },
    { label: 'No label path', path: '' },
    { label: 'Open Deal Studio', path: '/investment-calculator' },
  ] }));
  await send('Analyze a rental property');
  const shown = [...lastBubble().querySelectorAll('a')].filter((node) => !node.getAttribute('target')).map((node) => node.textContent.trim());
  expect(shown).toEqual(['Open Deal Studio']);
  expect(isSitePath('/search?status=rent')).toBe(true);
  expect(isSitePath('//example.com')).toBe(false);
  expect(isSitePath('/a b')).toBe(false);
  expect(isSitePath(undefined)).toBe(false);
});

test('the way to a person opens the request form of the right kind', async () => {
  axios.post.mockResolvedValue(answer({ handoff_recommended: true, handoff: { kind: 'seller', label: 'Send a seller request to a DiamondEcho agent', topic: null } }));
  await send('Can I talk to an agent about selling?');
  const link = lastBubble().querySelector('a[data-handoff="true"]');
  expect(link.textContent.trim()).toBe('Send a seller request to a DiamondEcho agent');
  expect(link.getAttribute('href')).toBe('/inquire?type=seller');
  expect(lastBubble().textContent).toContain('Your chat is not sent with the request.');
  await act(async () => link.click());
  expect(where()).toBe('/inquire?type=seller');
  expect(panel()).toBeNull();
});

test('handoffFor builds only the three request forms', () => {
  expect(handoffFor({ handoff: { kind: 'buyer', label: 'Ask about getting pre-approved', topic: 'pre-approval' } }))
    .toEqual({ path: '/inquire?type=buyer&topic=pre-approval', label: 'Ask about getting pre-approved' });
  expect(handoffFor({ handoff: { kind: 'tour', label: 'Request a property tour' } }).path).toBe('/inquire?type=tour');
  // An answer from a service that only says "a person should look at this".
  expect(handoffFor({ handoff_recommended: true })).toEqual({ path: '/inquire?type=buyer', label: 'Send a request to a DiamondEcho agent' });
  // Anything unexpected falls back to nothing, or to the plain buyer form.
  expect(handoffFor({ handoff: { kind: 'https://example.com', label: 'x' } })).toBeNull();
  expect(handoffFor({ handoff: { kind: 'seller', topic: '&x=1' } }).path).toBe('/inquire?type=seller');
  expect(handoffFor({})).toBeNull();
});

test('an answer with no need for a person offers no request link', async () => {
  axios.post.mockResolvedValue(answer());
  await send('How do I plan to sell my house?');
  expect(lastBubble().querySelector('a[data-handoff="true"]')).toBeNull();
  expect(lastBubble().textContent).not.toContain('Your chat is not sent');
});

describe('when the service does not answer', () => {
  test('the visitor can try again and the same question is asked once more', async () => {
    axios.post.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce(answer());
    await send('How do I plan to sell my house?');
    expect(bubbles()).toHaveLength(2);
    expect(lastBubble().dataset.failed).toBe('true');
    expect(lastBubble().textContent).toContain('I couldn’t get an answer just now.');
    // The request form is offered as the other way forward.
    expect(lastBubble().querySelector('a[data-handoff="true"]').getAttribute('href')).toBe('/inquire?type=buyer');

    await act(async () => byText(lastBubble(), 'button', 'Try again').click());
    await settle();
    expect(axios.post).toHaveBeenCalledTimes(2);
    const retried = axios.post.mock.calls[1][1];
    expect(retried.message).toBe('How do I plan to sell my house?');
    // The failure notice is not sent back as if it were part of the conversation.
    expect(retried.history).toEqual([{ role: 'user', content: 'How do I plan to sell my house?' }]);
    // One question on screen, then the answer; the notice is gone.
    expect(bubbles().map((node) => node.dataset.failed)).toEqual([undefined, undefined]);
    expect(bubbles()[0].textContent).toBe('How do I plan to sell my house?');
    expect(lastBubble().textContent).toContain('A seller plan should cover pricing evidence');
    expect(byText(panel(), 'button', 'Try again')).toBeUndefined();
  });

  test('a second failure leaves one notice, and typing a new question clears it', async () => {
    axios.post.mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(answer());
    await send('How do I plan to sell my house?');
    await act(async () => byText(lastBubble(), 'button', 'Try again').click());
    await settle();
    expect(bubbles().filter((node) => node.dataset.failed === 'true')).toHaveLength(1);
    expect(bubbles()).toHaveLength(2);
    await send('What should I compare in a mortgage?');
    expect(bubbles().filter((node) => node.dataset.failed === 'true')).toHaveLength(0);
    expect(axios.post.mock.calls[2][1].history).toEqual([
      { role: 'user', content: 'How do I plan to sell my house?' },
      { role: 'user', content: 'What should I compare in a mortgage?' },
    ]);
  });

  test('an answer with no text counts as no answer', async () => {
    axios.post.mockResolvedValueOnce({ data: {} });
    await send('Hello');
    expect(lastBubble().dataset.failed).toBe('true');
  });

  test('the send button works again after a failure', async () => {
    axios.post.mockRejectedValueOnce(new Error('x'));
    await send('Hello');
    await type('Another question');
    expect(panel().querySelector('button[aria-label="Send message"]').disabled).toBe(false);
  });
});

test('a quick prompt is sent as typed on the button', async () => {
  axios.post.mockResolvedValue(answer());
  await act(async () => byText(panel(), 'button', 'Help me plan a home purchase').click());
  await settle();
  expect(axios.post.mock.calls[0][1].message).toBe('Help me plan a home purchase');
});
