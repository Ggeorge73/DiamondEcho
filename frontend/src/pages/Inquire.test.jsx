import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import Inquire from './Inquire';

let container;
let root;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

test('an old listing parameter does not turn a tour request into a sample-property inquiry', async () => {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={['/inquire?type=tour&listing=1']}><Inquire /></MemoryRouter>);
  });
  expect(container.textContent).toContain('Tour request');
  expect(container.querySelector('#inquiry-propertyAddress')).not.toBeNull();
  expect(container.querySelector('.de-inquiry-property')).toBeNull();
  expect(container.querySelector('#inquiry-propertyAddress').value).toBe('');
  expect(container.querySelector('a[href="/inquire?type=tour"][aria-current="page"]')).not.toBeNull();
});

test('tour requests are discoverable from the inquiry page without a sample listing', async () => {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={['/inquire?type=buyer']}><Inquire /></MemoryRouter>);
  });
  expect(container.querySelector('a[href="/inquire?type=tour"]')).not.toBeNull();
  expect(container.querySelector('.de-inquiry-property')).toBeNull();
});
