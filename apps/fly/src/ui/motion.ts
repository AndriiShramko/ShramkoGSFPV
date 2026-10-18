// The reduced-motion setting (display.reducedMotion) as the app reads it: 'on' and 'off' decide, 'system' follows the
// operating system's own preference. One rule for the crash camera and the 3D drone stage (v0.9 lane D review).

/** True when motion should be calm. `v` is the setting's value ('system' | 'on' | 'off'). */
export function reducedMotion(v: string): boolean {
    if (v === 'on') return true;
    if (v === 'off') return false;
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
