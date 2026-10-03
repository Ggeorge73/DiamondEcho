import React, { act } from 'react';
import fs from 'fs';
import path from 'path';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import InvestmentCalculator from './InvestmentCalculator';

const css = fs.readFileSync(path.resolve(__dirname, '../App.css'), 'utf8');
const block = (query) => {
  const start = css.indexOf(`@media (${query}) {`);
  if (start < 0) return '';
  const next = css.indexOf('@media', start + 1);
  return css.slice(start, next < 0 ? undefined : next);
};

test('stacked Deal Studio column cannot be widened by its own content', () => {
  expect(block('max-width: 1180px')).toContain('.deal-studio-shell { grid-template-columns: minmax(0, 1fr); }');
  expect(block('max-width: 1180px')).not.toContain('.deal-studio-shell { grid-template-columns: 1fr; }');
  expect(css).toContain('.deal-studio-form, .deal-studio-results { min-width: 0; }');
});

test('scenario table drops its fixed width on phones and stacks the case name', () => {
  const phone = block('max-width: 460px');
  expect(phone).toContain('.studio-scenario-row { min-width: 0;');
  expect(phone).toContain('.studio-scenario-row strong { grid-column: 1 / -1; }');
  expect(css).toContain('.studio-scenario-table { margin-top: 13px; overflow-x: auto; }');
});

describe('rental decision view', () => {
  let container;
  let root;
  const savedBackend = process.env.REACT_APP_BACKEND_URL;
  beforeEach(async () => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    delete process.env.REACT_APP_BACKEND_URL;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(
      <MemoryRouter initialEntries={['/investment-calculator']}><InvestmentCalculator /></MemoryRouter>
    ));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    if (savedBackend === undefined) delete process.env.REACT_APP_BACKEND_URL;
    else process.env.REACT_APP_BACKEND_URL = savedBackend;
  });

  test('scenario table is a labelled region that keyboard users can scroll', async () => {
    const submit = [...container.querySelectorAll('button')].find((item) => item.textContent.includes('Run base analysis'));
    await act(async () => { submit.click(); });
    await act(async () => { await Promise.resolve(); });
    const table = container.querySelector('.studio-scenario-table');
    expect(table).not.toBeNull();
    expect(table.getAttribute('role')).toBe('region');
    expect(table.getAttribute('aria-label')).toBe('Deterministic scenarios');
    expect(table.tabIndex).toBe(0);
    const head = [...table.querySelectorAll('.studio-scenario-row--head span')].map((cell) => cell.textContent);
    expect(head).toEqual(['Case', 'NOI', 'CoC', 'DSCR', 'IRR']);
    expect(table.querySelectorAll('.studio-scenario-row:not(.studio-scenario-row--head)')).toHaveLength(3);
  });
});
