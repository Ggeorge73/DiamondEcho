import { TOOL_PATHS, currentToolAddress, isToolPath, scrollKey, toolFromLocation, toolFromSearch } from './intelligenceTools';

test('each tool has an address of its own', () => {
  expect(TOOL_PATHS).toEqual({ deal: '/investment-calculator', mortgage: '/mortgage-calculator', 'net-proceeds': '/seller-net-sheet' });
  expect(toolFromLocation('/investment-calculator', '')).toBe('deal');
  expect(toolFromLocation('/mortgage-calculator', '')).toBe('mortgage');
  expect(toolFromLocation('/mortgage-calculator/', '?price=400000')).toBe('mortgage');
  expect(toolFromLocation('/seller-net-sheet', '')).toBe('net-proceeds');
  expect(isToolPath('/seller-net-sheet/')).toBe(true);
  expect(isToolPath('/search')).toBe(false);
});

test('an older "?tool=" link still chooses the tool, and anything unknown opens Deal Studio', () => {
  expect(toolFromSearch('')).toBe('deal');
  expect(toolFromSearch('?tool=mortgage')).toBe('mortgage');
  expect(toolFromSearch('?tool=net-proceeds&x=1')).toBe('net-proceeds');
  expect(toolFromSearch('?tool=deal')).toBe('deal');
  expect(toolFromSearch('?tool=<script>')).toBe('deal');
  expect(toolFromSearch('?listing=12')).toBe('deal');
  expect(toolFromLocation('/investment-calculator', '?tool=mortgage')).toBe('mortgage');
  expect(toolFromLocation('/investment-calculator', '?tool=lottery')).toBe('deal');
});

test('a tool\'s own address wins over a "tool" part, which is only read on the Deal Studio address', () => {
  expect(toolFromLocation('/mortgage-calculator', '?tool=net-proceeds')).toBe('mortgage');
  expect(toolFromLocation('/about', '?tool=mortgage')).toBe('deal');
});

test('an older link is pointed at the tool\'s own address, keeping everything else it carried', () => {
  expect(currentToolAddress('/investment-calculator', '?tool=mortgage')).toBe('/mortgage-calculator');
  expect(currentToolAddress('/investment-calculator', '?tool=mortgage&price=525000&taxes=6100&hoa=140')).toBe('/mortgage-calculator?price=525000&taxes=6100&hoa=140');
  expect(currentToolAddress('/investment-calculator', '?utm_source=mail&tool=net-proceeds')).toBe('/seller-net-sheet?utm_source=mail');
  expect(currentToolAddress('/investment-calculator', '?tool=deal')).toBe('/investment-calculator');
  expect(currentToolAddress('/investment-calculator', '?tool=lottery&listing=1')).toBe('/investment-calculator?listing=1');
  expect(currentToolAddress('/mortgage-calculator', '?tool=net-proceeds')).toBe('/mortgage-calculator');
  // Nothing to do when the address is already the tool's own.
  expect(currentToolAddress('/investment-calculator', '')).toBeNull();
  expect(currentToolAddress('/mortgage-calculator', '?price=400000')).toBeNull();
});

test('moving between the tools is not a new page for scrolling', () => {
  const page = '/investment-calculator';
  expect(scrollKey('/mortgage-calculator', '')).toBe(scrollKey(page, ''));
  expect(scrollKey('/seller-net-sheet', '')).toBe(scrollKey('/mortgage-calculator', ''));
  expect(scrollKey(page, '?tool=mortgage')).toBe(scrollKey(page, ''));
  expect(scrollKey(page, '?tool=mortgage')).toBe(scrollKey('/mortgage-calculator', ''));
  expect(scrollKey('/mortgage-calculator', '?price=400000')).not.toBe(scrollKey('/mortgage-calculator', '?price=500000'));
  expect(scrollKey('/inquire', '?type=buyer')).not.toBe(scrollKey('/inquire', '?type=seller'));
  expect(scrollKey('/search', '')).not.toBe(scrollKey(page, ''));
});
