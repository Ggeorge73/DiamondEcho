import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import RealEstateAssistant, { launcherOverlapsFrame } from './RealEstateAssistant';

const viewport = { width: 390, height: 844 };
const rect = (top, bottom, left = 16, right = 364) => ({ top, bottom, left, right });

test('launcher overlap is true only when the frame is under the launcher box', () => {
  // Launcher box at 390 x 844: x 182 to 370, y 768 to 824.
  expect(launcherOverlapsFrame(rect(537, 1353), viewport)).toBe(true);
  expect(launcherOverlapsFrame(rect(-600, 120), viewport)).toBe(false);
  expect(launcherOverlapsFrame(rect(830, 1650), viewport)).toBe(false);
  expect(launcherOverlapsFrame(rect(-100, 768), viewport)).toBe(false);
  expect(launcherOverlapsFrame(rect(-100, 769), viewport)).toBe(true);
  // A wide screen where the centred frame ends left of the launcher.
  expect(launcherOverlapsFrame(rect(200, 1100, 344, 1656), { width: 2000, height: 1200 })).toBe(false);
});

describe('launcher next to the Georgia MLS frame', () => {
  let container;
  let root;
  let frame;
  let frameRect;
  const originalSize = { width: window.innerWidth, height: window.innerHeight };
  const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
  const button = () => container.querySelector('button[aria-label="Open DiamondEcho assistant"]');
  const label = () => [...button().querySelectorAll('span')].find((node) => node.textContent === 'Ask DiamondEcho');

  beforeEach(async () => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    Object.assign(window, { innerWidth: viewport.width, innerHeight: viewport.height });
    frame = document.createElement('iframe');
    frame.className = 'de-idx__frame';
    frameRect = rect(537, 1353);
    frame.getBoundingClientRect = () => frameRect;
    document.body.appendChild(frame);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(
      <MemoryRouter initialEntries={['/search']}><RealEstateAssistant /></MemoryRouter>
    ));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    frame.remove();
    Object.assign(window, { innerWidth: originalSize.width, innerHeight: originalSize.height });
  });

  test('shrinks to its icon while over the frame and keeps its accessible name', () => {
    expect(button().dataset.compact).toBe('true');
    expect(label().className).toBe('sr-only');
    expect(button().getAttribute('aria-label')).toBe('Open DiamondEcho assistant');
    expect(button().getAttribute('title')).toBe('Ask DiamondEcho');
  });

  test('shows its label again once the frame has scrolled away', async () => {
    frameRect = rect(-900, -84);
    await act(async () => { window.dispatchEvent(new Event('scroll')); });
    await settle();
    expect(button().dataset.compact).toBe('false');
    expect(label().className).not.toBe('sr-only');
    expect(button().hasAttribute('title')).toBe(false);
  });

  test('is not shrunk while the assistant panel is open', async () => {
    await act(async () => button().click());
    expect(container.querySelector('[aria-label="DiamondEcho real estate assistant"]')).not.toBeNull();
    expect(button().dataset.compact).toBe('false');
  });
});

test('launcher keeps its label on pages without the search frame', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/about']}><RealEstateAssistant /></MemoryRouter>
  ));
  const trigger = container.querySelector('button[aria-label="Open DiamondEcho assistant"]');
  expect(trigger.dataset.compact).toBe('false');
  expect(trigger.textContent).toContain('Ask DiamondEcho');
  await act(async () => root.unmount());
  container.remove();
});
