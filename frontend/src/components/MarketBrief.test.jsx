import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import MarketBrief from './MarketBrief';
import { BriefAudioProvider, HEARD_KEY, chimeUri } from './BriefAudio';

const BRIEF = {
  date: '2026-10-09',
  generated_at: '2026-10-09T11:00:00+00:00',
  tour: { script: 'Welcome to DiamondEcho Realty. I am your guide.', audio_url: '/api/v1/market-brief/audio/tour-0123456789abcdef.mp3' },
  market: {
    script: 'Here is the Georgia market brief for Friday, October 9, 2026.',
    audio_url: '/api/v1/market-brief/audio/2026-10-09.mp3',
    items: [{
      id: 'mortgage_30', label: '30-year fixed mortgage rate', region: 'United States', value: '6.12%',
      change: 'down 0.13 percentage points from the week before', period: 'the week of October 8, 2026',
      as_of: '2026-10-08', source: "Freddie Mac's Primary Mortgage Market Survey", source_url: 'https://www.freddiemac.com/pmms',
    }],
    unavailable: [],
  },
  not_used: [],
};

let container;
let root;
let savedBackend;
let play;
let pause;

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
// The player sits above the pages (App.js); `page` is what the route shows.
const render = async (page = <MarketBrief />) => {
  await act(async () => root.render(<BriefAudioProvider>{page}</BriefAudioProvider>));
  await flush();
};
const audio = () => container.querySelector('audio');
const barPlay = () => container.querySelector('.mf-brief-bar .mf-brief__play');

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  savedBackend = process.env.REACT_APP_BACKEND_URL;
  process.env.REACT_APP_BACKEND_URL = 'https://api.example.test/';
  window.sessionStorage.clear();
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(BRIEF) }));
  // Like a browser that blocks sound until the visitor interacts.
  play = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.reject(new Error('NotAllowedError')));
  pause = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  play.mockRestore();
  pause.mockRestore();
  delete global.fetch;
  if (savedBackend === undefined) delete process.env.REACT_APP_BACKEND_URL;
  else process.env.REACT_APP_BACKEND_URL = savedBackend;
});

test('shows nothing without a service to read the brief from', async () => {
  delete process.env.REACT_APP_BACKEND_URL;
  await render();
  expect(container.innerHTML).toBe('');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('shows nothing when the service has no brief', async () => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
  await render();
  expect(container.innerHTML).toBe('');
});

test('lists each figure with its period and a link to its publisher', async () => {
  await render();
  expect(global.fetch).toHaveBeenCalledWith('https://api.example.test/api/v1/market-brief');
  const figure = container.querySelector('.mf-brief__figures li');
  expect(figure.textContent).toContain('6.12%');
  expect(figure.textContent).toContain('the week of October 8, 2026');
  const link = figure.querySelector('a');
  expect(link.href).toBe('https://www.freddiemac.com/pmms');
  expect(link.rel).toBe('noopener noreferrer');
  expect(container.textContent).toContain('Friday, October 9, 2026');
});

test('tries to start at once, then starts on the first click anywhere: chime, welcome tour, then market', async () => {
  await render();
  expect(play).toHaveBeenCalledTimes(1);
  expect(barPlay().getAttribute('aria-label')).toBe('Play the welcome tour and market brief');
  expect(container.textContent).toContain('Tap anywhere to hear your welcome to DiamondEcho');

  play.mockImplementation(() => Promise.resolve());
  await act(async () => { document.body.click(); });
  await flush();
  // The chime plays through the same audio element as the voice, inside the click.
  expect(audio().getAttribute('src')).toBe(chimeUri());
  expect(play).toHaveBeenCalledTimes(2);
  expect(barPlay().getAttribute('aria-label')).toBe('Pause the audio');
  expect(container.textContent).toContain('Welcome and site tour');

  await act(async () => { audio().dispatchEvent(new Event('ended')); });
  await flush();
  expect(audio().getAttribute('src')).toBe('https://api.example.test/api/v1/market-brief/audio/tour-0123456789abcdef.mp3');

  // The tour leads straight into the day's market brief.
  await act(async () => { audio().dispatchEvent(new Event('ended')); });
  await flush();
  expect(audio().getAttribute('src')).toBe('https://api.example.test/api/v1/market-brief/audio/2026-10-09.mp3');
  expect(container.textContent).toContain('Today’s Georgia market');

  await act(async () => { audio().dispatchEvent(new Event('ended')); });
  expect(window.sessionStorage.getItem(HEARD_KEY)).toBe('1');
  expect(container.querySelector('.mf-brief-bar')).toBeNull();
});

test('when the browser allows sound at once, the chime still comes first', async () => {
  play.mockImplementation(() => Promise.resolve());
  await render();
  expect(audio().getAttribute('src')).toBe(chimeUri());
  expect(barPlay().getAttribute('aria-label')).toBe('Pause the audio');
});

test('the chime is a short, valid WAV clip', () => {
  const uri = chimeUri();
  expect(uri.startsWith('data:audio/wav;base64,')).toBe(true);
  const bytes = window.atob(uri.split(',')[1]);
  expect(bytes.slice(0, 4)).toBe('RIFF');
  expect(bytes.slice(8, 12)).toBe('WAVE');
  expect(bytes.length).toBe(44 + 16000 * 1.6 * 2);
});

test('pause stops the sound and the brief does not start again in the same visit', async () => {
  play.mockImplementation(() => Promise.resolve());
  await render();
  expect(barPlay().getAttribute('aria-label')).toBe('Pause the audio');
  await act(async () => { barPlay().click(); });
  expect(pause).toHaveBeenCalled();
  expect(window.sessionStorage.getItem(HEARD_KEY)).toBe('1');

  await act(async () => root.unmount());
  root = createRoot(container);
  play.mockClear();
  await render();
  expect(play).not.toHaveBeenCalled();
  expect(container.querySelector('.mf-brief-bar')).toBeNull();
  expect(container.querySelector('.mf-brief__play')).not.toBeNull(); // still playable on request
});

test('closing the bar stops the audio and hides it', async () => {
  await render();
  await act(async () => { container.querySelector('.mf-brief-bar__close').click(); });
  expect(pause).toHaveBeenCalled();
  expect(container.querySelector('.mf-brief-bar')).toBeNull();
});

test('the transcript gives the same words as text', async () => {
  await render();
  const toggle = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Read the transcript');
  await act(async () => { toggle.click(); });
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  const transcript = container.querySelector('#market-brief-transcript').textContent;
  expect(transcript).toContain(BRIEF.tour.script);
  expect(transcript).toContain(BRIEF.market.script);
});

test('without audio the figures still show and no player is offered', async () => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({
    ...BRIEF, tour: { ...BRIEF.tour, audio_url: null }, market: { ...BRIEF.market, audio_url: null },
  }) }));
  await render();
  expect(container.querySelector('.mf-brief__figures li')).not.toBeNull();
  expect(container.querySelector('.mf-brief__play')).toBeNull();
  expect(container.querySelector('.mf-brief-bar')).toBeNull();
});

test('the sound carries on when the visitor leaves the home page, until paused', async () => {
  play.mockImplementation(() => Promise.resolve());
  await render();
  await act(async () => { audio().dispatchEvent(new Event('ended')); });
  await flush();
  expect(audio().getAttribute('src')).toContain('tour-0123456789abcdef.mp3');

  // Another page: the section is gone, the bar and the sound stay.
  pause.mockClear();
  await render(<main>Search</main>);
  expect(container.querySelector('#market-brief')).toBeNull();
  expect(pause).not.toHaveBeenCalled();
  expect(audio().getAttribute('src')).toContain('tour-0123456789abcdef.mp3');
  expect(barPlay().getAttribute('aria-label')).toBe('Pause the audio');

  // The tour still leads into the market brief on the other page.
  await act(async () => { audio().dispatchEvent(new Event('ended')); });
  await flush();
  expect(audio().getAttribute('src')).toContain('2026-10-09.mp3');

  // Pause in the bar stops it there.
  await act(async () => { barPlay().click(); });
  expect(pause).toHaveBeenCalled();
  expect(barPlay().getAttribute('aria-label')).toBe('Play the welcome tour and market brief');
});

test('a visitor who arrives on another page is welcomed there too', async () => {
  await render(<main>About</main>);
  expect(container.querySelector('.mf-brief-bar').textContent).toContain('Tap anywhere to hear your welcome to DiamondEcho');
  play.mockImplementation(() => Promise.resolve());
  await act(async () => { document.body.click(); });
  await flush();
  expect(audio().getAttribute('src')).toBe(chimeUri());
});
