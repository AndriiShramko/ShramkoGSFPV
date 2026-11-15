// Train 3, lane quiet, Q4 (the owner's message 54): one key switches the narrator off and on during a flight in the sound mode. The
// Shift+V (lane quiet2, N2: a letter, the same on every layout), a key of the sound mode only; on: two words, off: a sound alone; the change saved and applied at once.
import { describe, expect, it } from 'vitest';
import { KEYMAP } from '../../../packages/prefs/src/keymap';
import { narratorKey } from '../../../apps/fly/src/sonic/narrator-key';
import { KEY_HELP } from '../../../apps/fly/src/sonic/mode-keys';

function page(start: boolean | undefined, refuse = false) {
    const prefs: { narrator?: boolean } = start === undefined ? {} : { narrator: start };
    const log: string[] = [];
    const run = narratorKey({
        on: () => prefs.narrator !== false,
        set: (on) => {
            if (refuse) return false;
            prefs.narrator = on;
            log.push(`set ${on}`);
            return true;
        },
        // read when said: the narrator must already be on when "Narrator on" is said
        sayOn: () => log.push(`say narratorOn (narrator ${prefs.narrator !== false ? 'on' : 'off'})`),
        cueOff: () => log.push('cue off')
    });
    return { prefs, log, run };
}

describe('Q4: the narrator key', () => {
    it('is Shift+V, in the sound mode only, bound nowhere else, and K says it', () => {
        const b = KEYMAP.find((x) => x.action === 'sonic.narrator');
        expect(b?.keys.map((k) => `${k.shift === true ? 'Shift+' : ''}${k.code}`)).toEqual(['Shift+KeyV']);
        expect(b?.when).toBe('sonic');
        expect(b?.status).toBe('shipped');
        expect(KEYMAP.filter((x) => x.keys.some((k) => k.code === 'KeyV' && k.shift === true)).map((x) => x.action)).toEqual(['sonic.narrator']);
        expect(KEY_HELP.find(([, action]) => action === 'sonic.narrator')?.[0]).toBe('sonic.say.helpNarrator');
    });

    it('off from the default (absent means on): saved off, a sound and no word', () => {
        const p = page(undefined);
        p.run({ repeat: false });
        expect(p.prefs.narrator).toBe(false);
        expect(p.log).toEqual(['set false', 'cue off']);
    });

    it('on again: saved on, then the two words said with the narrator already on', () => {
        const p = page(false);
        p.run({ repeat: false });
        expect(p.prefs.narrator).toBe(true);
        expect(p.log).toEqual(['set true', 'say narratorOn (narrator on)']);
    });

    it('a held key flips once; a refused change says and plays nothing', () => {
        const p = page(true);
        p.run({ repeat: false });
        p.run({ repeat: true });
        p.run({ repeat: true });
        expect(p.log).toEqual(['set false', 'cue off']);
        const q = page(true, true);
        q.run({ repeat: false });
        expect(q.log).toEqual([]);
        expect(q.prefs.narrator).toBe(true);
    });
});
