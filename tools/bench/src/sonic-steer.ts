// The probe pilot's small rules (tools/bench/src/sonic-int-review.ts steerByHum), kept apart so a unit test can hold them.

/**
 * Whether the hum's horizontal direction turned between two samples (more than about 5.7 degrees: cos 0.995, an estimate).
 * Both directions are projected on the ground and normalised first: the S1 Housefly run held the craft still for 14 s at
 * gate 2 with the hum 6 degrees below the nose, and the unnormalised dot product of [-0.04, -0.11, -0.99] with itself on the
 * ground (0.982) read as a turn every frame, so the stall rule never fired (0 dodges in the whole run).
 */
export function humTurned(a: readonly number[] | undefined, b: readonly number[] | undefined): boolean {
    if (a === undefined || b === undefined) return false;
    const la = Math.hypot(a[0] ?? 0, a[2] ?? 0);
    const lb = Math.hypot(b[0] ?? 0, b[2] ?? 0);
    // straight above or below: no ground direction to compare
    if (la < 1e-3 || lb < 1e-3) return false;
    return ((a[0] ?? 0) * (b[0] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0)) / (la * lb) < 0.995;
}
