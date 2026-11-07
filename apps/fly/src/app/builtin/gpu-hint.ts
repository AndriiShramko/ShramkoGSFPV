// The GPU hint (v0.12, lane v12-flight, docs/wip/v12-plan.md sections 2.12 and 4.2 step 11): on Windows,
// with WebGPU on an integrated Intel GPU, a scene note that says how to switch the browser to the
// high-performance GPU. Step 0 of the lead left this empty feature so the lanes never edit features.ts;
// the lane owns this file from here and fills install().
import type { Feature } from '../context';

export const gpuHint: Feature = {
    id: 'gpu-hint',
    install() {
        // v12-flight
    }
};
