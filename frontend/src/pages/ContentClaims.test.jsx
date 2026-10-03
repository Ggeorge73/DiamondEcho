import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import About from './About';
import Agents from './Agents';

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
