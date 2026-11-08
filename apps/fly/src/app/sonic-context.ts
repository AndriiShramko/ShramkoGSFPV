// The seams of Fly by Sound in the flight page (v0.12, docs/wip/v12-plan.md section 3, step 5): the event
// bus and the flight context carry the mode's data, so neither lane edits context.ts. Types only, taken
// from the shared contract of the sound package (packages/sonic-fpv, the git submodule). context.ts
// imports this file, so the two members below exist wherever the context's types do.
import type { FlightSample, SessionEvent, SonicRuntime } from '@shramko/sonic-fpv';

declare module './context' {
    interface AppEvents {
        /** one FlightSample per rendered frame while the mode runs (the bridge, lane v12-flight) */
        sonicSample: FlightSample;
        /** every event of the mode's session (lesson, touch, gate, key, speech ...), in order */
        sonicEvent: SessionEvent;
    }

    interface FlightContext {
        /**
         * What the mode exposes to the other features: the recorder and the replay read it, only lane
         * v12-flight writes it. Absent while the mode is off.
         */
        sonic?: SonicRuntime;
        /**
         * The mode's own Share (v12-optin review R1, R3): the lesson's link instead of a picture of the view, for L (`'key'`: copied and
         * said, a field to copy it by hand only when the browser refuses) and for the visible Share of the top bar and the pause menu
         * (`'button'`: copied, said and shown in that field, for a helper and for a phone, which has no L). Set by the mode
         * (sonic/feature.ts), read by app/builtin/share.ts; absent on every other page.
         */
        sonicShare?: (via: 'key' | 'button') => void;
    }
}
