import { resolve } from 'path';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: false,
  test: {
    include: ['**/*.e2e-spec.ts'],
    globals: true,
    root: './',
    alias: {
      '@src': resolve(__dirname, './src'),
      '@test': resolve(__dirname, './test'),
      src: resolve(__dirname, './src'),
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
  resolve: {
    alias: {
      '@src': resolve(__dirname, './src'),
      '@test': resolve(__dirname, './test'),
      src: resolve(__dirname, './src'),
    },
  },
});
