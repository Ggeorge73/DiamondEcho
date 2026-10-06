import { scrollKey, toolFromSearch } from './intelligenceTools';

test('the address chooses the tool, and anything unknown opens Deal Studio', () => {
  expect(toolFromSearch('')).toBe('deal');
  expect(toolFromSearch('?tool=mortgage')).toBe('mortgage');
  expect(toolFromSearch('?tool=net-proceeds&x=1')).toBe('net-proceeds');
  expect(toolFromSearch('?tool=deal')).toBe('deal');
  expect(toolFromSearch('?tool=<script>')).toBe('deal');
  expect(toolFromSearch('?listing=12')).toBe('deal');
});

test('changing only the tool is not a new page for scrolling', () => {
  const page = '/investment-calculator';
  expect(scrollKey(page, '?tool=mortgage')).toBe(scrollKey(page, ''));
  expect(scrollKey(page, '?tool=mortgage')).toBe(scrollKey(page, '?tool=net-proceeds'));
  expect(scrollKey(page, '?tool=mortgage&price=400000')).not.toBe(scrollKey(page, '?tool=mortgage&price=500000'));
  expect(scrollKey('/inquire', '?type=buyer')).not.toBe(scrollKey('/inquire', '?type=seller'));
  expect(scrollKey('/search', '')).not.toBe(scrollKey(page, ''));
});
