import { defineConfig } from 'vitest/config';

// The measured proof (checkTrack with free-radius probes) takes about 5 s on the three-room world (measured, time of the
// first test in docs/wip/tracks.md Findings); with other lanes on the machine it passed 5 s, the default timeout.
export default defineConfig({ test: { testTimeout: 60000 } });
