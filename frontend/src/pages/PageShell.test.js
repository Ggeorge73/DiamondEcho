import fs from 'fs';
import path from 'path';

const shell = fs.readFileSync(path.resolve(__dirname, '../../public/index.html'), 'utf8');

test('page shell carries no builder badge', () => {
  expect(shell).not.toContain('emergent-badge');
  expect(shell.toLowerCase()).not.toContain('made with emergent');
  expect(shell).not.toContain('app.emergent.sh');
});

test('page shell keeps the app mount point and title', () => {
  expect(shell).toContain('<div id="root"></div>');
  expect(shell).toContain('<title>DiamondEcho | Private Real Estate</title>');
});
