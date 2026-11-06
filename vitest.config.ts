import { defineConfig } from 'vitest/config';
import { algorithmHash } from './scripts/algorithm-hash';

export default defineConfig({
  // Tests see the real hash; core.test.ts checks that version.ts acknowledges it.
  define: { __ALGORITHM_HASH__: JSON.stringify(algorithmHash().key) },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
