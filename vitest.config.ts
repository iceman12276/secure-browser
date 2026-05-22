import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests live under tests/unit; the rest of tests/ is Playwright e2e.
    include: ['tests/unit/**/*.spec.ts'],
  },
});
