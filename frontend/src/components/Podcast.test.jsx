import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import LatestEpisode from './LatestEpisode';
import Podcast from '../pages/Podcast';
import { claimAudio } from '../lib/audioFocus';

const EPISODES = [
  { id: 'b'.repeat(32), title: 'Atlanta in October', description: 'Rates, listings and what they mean for buyers.',
    published_at: '2026-10-09T16:00:00+00:00', audio_url: 'https://storage.googleapis.com/diamondecho-podcast/episodes/b.mp3' },
  { id: 'a'.repeat(32), title: 'Selling in a slower market', description: '',
    published_at: '2026-10-02T16:00:00+00:00', audio_url: 'https://storage.googleapis.com/diamondecho-podcast/episodes/a.m4a' },
];

let container;
let root;
let savedBackend;

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const render = async (element) => {
  await act(async () => root.render(<MemoryRouter>{element}</MemoryRouter>));
  await flush();
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  savedBackend = process.env.REACT_APP_BACKEND_URL;
  process.env.REACT_APP_BACKEND_URL = 'https://api.example.test';
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ items: EPISODES }) }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete global.fetch;
  if (savedBackend === undefined) delete process.env.REACT_APP_BACKEND_URL;
  else process.env.REACT_APP_BACKEND_URL = savedBackend;
});

test('the home page shows only the newest episode, with a link to all episodes', async () => {
  await render(<LatestEpisode />);
  expect(global.fetch).toHaveBeenCalledWith('https://api.example.test/api/v1/podcast/episodes');
  expect(container.querySelector('#latest-episode-heading').textContent).toBe('Latest episode');
  expect(container.querySelectorAll('audio')).toHaveLength(1);
  expect(container.textContent).toContain('Atlanta in October');
  expect(container.textContent).toContain('October 9, 2026');
  expect(container.textContent).not.toContain('Selling in a slower market');
  const audio = container.querySelector('audio');
  expect(audio.getAttribute('src')).toBe(EPISODES[0].audio_url);
  expect(audio.hasAttribute('controls')).toBe(true);
  expect(audio.getAttribute('preload')).toBe('none');
  expect(container.querySelector('a[href="/podcast"]').textContent).toContain('All episodes');
});

test('the home page shows nothing before the first episode, or without the service', async () => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) }));
  await render(<LatestEpisode />);
  expect(container.innerHTML).toBe('');
  delete process.env.REACT_APP_BACKEND_URL;
  await act(async () => root.unmount());
  root = createRoot(container);
  await render(<LatestEpisode />);
  expect(container.innerHTML).toBe('');
});

test('the podcast page lists every episode, newest first, each with its own player', async () => {
  await render(<Podcast />);
  const items = [...container.querySelectorAll('.mf-podcast-page__list > li')];
  expect(items.map((li) => li.querySelector('h2').textContent)).toEqual(['Atlanta in October', 'Selling in a slower market']);
  expect(items.every((li) => li.querySelector('audio[controls]'))).toBe(true);
  expect(container.querySelector('h1').textContent).toBe('Conversations on Georgia real estate.');
});

test('the podcast page says the first episode is coming when there are none', async () => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
  await render(<Podcast />);
  expect(container.textContent).toContain('The first episode is on its way.');
});

test('starting one episode pauses the others and the daily brief', async () => {
  await render(<Podcast />);
  const audios = [...container.querySelectorAll('audio')];
  const pauses = audios.map((audio) => vi.spyOn(audio, 'pause').mockImplementation(() => {}));
  await act(async () => { audios[0].dispatchEvent(new Event('play')); });
  expect(pauses[0]).not.toHaveBeenCalled();
  expect(pauses[1]).toHaveBeenCalled();
  await act(async () => { claimAudio('brief'); });
  expect(pauses[0]).toHaveBeenCalled();
});
