// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true, // Use global APIs (describe, it, expect) without explicit imports in test files
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest}.config.*',
      '**/.idea/**',
      '**/.vscode/**',
      '**/.nyc_output/**',
      '**/coverage/**',
      '**/drizzle*.config.test.ts',
    ],
  },
});