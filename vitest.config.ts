import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['packages/*/test/**/*.test.ts', 'apps/site/test/**/*.test.ts', 'tools/bench/test/**/*.test.ts', 'tools/blackbox/test/**/*.test.ts'],
        testTimeout: 120000,
        // a hook that imports a large part of the page (the recorder's session side: the sound package, the zip writer, the replay)
        // took over vitest's default 10 s under the load of many files at once (v12-optin): hooks get the tests' own limit
        hookTimeout: 120000
    }
});
