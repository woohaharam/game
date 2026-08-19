import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

/**
 * `base` is driven by an env var so one build config serves both local dev
 * (`/`) and a GitHub Pages project site (`/<repo>/`).
 */
export default defineConfig({
  base: process.env.PUBLIC_BASE_PATH ?? '/',
  resolve: {
    alias: {
      '@engine': fileURLToPath(new URL('./src/engine', import.meta.url)),
      '@game': fileURLToPath(new URL('./src/game', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
