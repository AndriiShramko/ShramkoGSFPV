import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['packages/*/test/**/*.test.ts', 'tools/bench/test/**/*.test.ts'],
        testTimeout: 120000
    }
});
