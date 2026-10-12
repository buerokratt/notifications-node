import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    clearMocks: true,
    coverage: {
      include: ['src/**/*.{ts,tsx}'],
      provider: 'v8',
      reporter: ['text'],
    },
    environment: 'jsdom',
    restoreMocks: true,
    setupFiles: ['./test/setup.ts'],
  },
});
