// The pilot's voice in a replay (docs/wip/v12-plan.md section 4.3 step 5): voice.webm decoded by the browser and scheduled on the
// SAME AudioContext clock that paces the replay's frames, so the voice and the flight cannot drift apart however long the
// replay runs: every time the replay starts, resumes or seeks, one reference is taken, "package time T is audio time A", and both the
// voice (source.start(A + ..., offset)) and the frame clock (T + (now - A)) are worked out from it.
//
// Package time is the session clock of the recording (t = 0 when it began); the voice file starts `voiceOffsetMs` after it
// (manifest.clock.voiceOffsetMs: the moment MediaRecorder.start() was called, measured in step 2).
export interface VoicePlan {
    /** seconds from the reference on the audio clock until the voice begins to sound */
    readonly atS: number;
    /** where in the voice buffer it begins, seconds */
    readonly offsetS: number;
    /** false when the voice is already over at that package time */
    readonly audible: boolean;
}

/** Where the voice starts when the replay begins at package time `tMs`: later than now (before the voice began), or part way in. */
export function voicePlan(voiceOffsetMs: number, tMs: number, durationS: number): VoicePlan {
    const ahead = (voiceOffsetMs - tMs) / 1000;
    if (ahead >= 0) return { atS: ahead, offsetS: 0, audible: durationS > 0 };
    const into = -ahead;
    return { atS: 0, offsetS: into, audible: into < durationS };
}

export interface VoiceBuffer {
    readonly duration: number;
}

export interface VoiceHandle {
    stop(): void;
}

/** What the player needs of the voice: decode the file, start it on the audio clock. */
export interface VoiceDeps {
    decode(bytes: Uint8Array): Promise<VoiceBuffer>;
    /** begin at audio time `whenAc` (seconds on the context's clock), `offsetS` seconds into the buffer */
    play(buffer: VoiceBuffer, whenAc: number, offsetS: number): VoiceHandle;
}

/**
 * The browser's voice: decodeAudioData (Opus in WebM) and one AudioBufferSourceNode per start into `out` (the engine's input node, which is
 * in front of its limiter, when there is one: a pilot's own voice must not be louder than the ceiling the rest of the mode keeps).
 * A start whose time has already passed by a few milliseconds is made up by beginning further into the buffer, so a late call never
 * shifts the voice against the frames.
 */
export function webAudioVoice(ac: AudioContext, out: AudioNode): VoiceDeps {
    return {
        async decode(bytes) {
            // decodeAudioData takes (detaches) the buffer it is given
            return ac.decodeAudioData(bytes.slice().buffer);
        },
        play(buffer, whenAc, offsetS) {
            const source = ac.createBufferSource();
            source.buffer = buffer as AudioBuffer;
            source.connect(out);
            const late = ac.currentTime - whenAc;
            if (late > 0) source.start(ac.currentTime, offsetS + late);
            else source.start(whenAc, offsetS);
            return {
                stop() {
                    try {
                        source.stop();
                    } catch {
                        // not started yet or already stopped
                    }
                    source.disconnect();
                }
            };
        }
    };
}
