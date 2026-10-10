import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Not import.meta.dirname: that needs Node 20.11, and the Pages image's Node 20
// minor is not pinned.
const root = dirname(fileURLToPath(import.meta.url));
const src = resolve(root, 'src');

// The source reads settings as process.env.REACT_APP_*, as it did under Create
// React App. Every such name the source uses is replaced at build time with the
// value from the environment or a .env file, or with undefined when unset, so
// Cloudflare Pages keeps its REACT_APP_* variable names. Tests (VITEST) read
// the real process.env instead, because they change it between cases.
// The directory listing says which entries are folders, so no file is checked
// and then read in two steps.
const usedNames = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const { name } = entry;
  const path = join(dir, name);
  if (entry.isDirectory()) return usedNames(path);
  if (!/\.jsx?$/.test(name) || /\.test\.jsx?$/.test(name)) return [];
  return [...readFileSync(path, 'utf8').matchAll(/process\.env\.(REACT_APP_\w+)/g)].map((match) => match[1]);
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, 'REACT_APP_');
  const define = process.env.VITEST ? {} : Object.fromEntries(
    [...new Set(usedNames(src))].map((name) => [`process.env.${name}`, JSON.stringify(env[name])]),
  );
  return {
    plugins: [react()],
    define,
    resolve: { alias: { '@': src } },
    // Some files ending in .js hold JSX (App.js, index.js and tests).
    esbuild: { loader: 'jsx', include: /src\/.*\.jsx?$/, exclude: [] },
    optimizeDeps: { esbuildOptions: { loader: { '.js': 'jsx' } } },
    server: { host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT) || 3000 },
    // Same folder and source maps as the Create React App build, so the Pages
    // project settings do not change.
    build: { outDir: 'build', emptyOutDir: true, sourcemap: true },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['src/setupTests.js'],
      include: ['src/**/*.test.{js,jsx}'],
      // Create React App's Jest reset every mock between tests.
      mockReset: true,
    },
  };
});
