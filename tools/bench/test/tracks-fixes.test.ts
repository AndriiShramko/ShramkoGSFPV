// Lane tracks, stage fixes of train 2: the review findings that have a pure part. TK-2 (site storage blocked: the course
// feature must not throw at install), TK-3 (keyboard path into the editor window), TK-5 (the admin's link names the
// version), TK-7 (edit tokens kept across reloads), TK-12 (a double click does not pass the two-click confirm).
import { afterEach, describe, expect, it } from 'vitest';
import { confirmStep, CONFIRM_GUARD_MS, editorLink } from '../../../apps/fly/src/admin/tracks/model';
import { editorKey, KEY_ROWS, keyRoute } from '../../../apps/fly/src/course/editor/keys';
import { servedOfLink, serverOfLink } from '../../../apps/fly/src/course/link';
import { myTokens, myVotes, rememberToken, rememberVote, siteStorage, TOKENS_KEPT, voterId } from '../../../apps/fly/src/course/store';

function memory(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('TK-2 site storage blocked', () => {
    const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    afterEach(() => {
        if (had) Object.defineProperty(globalThis, 'localStorage', had);
        else delete (globalThis as { localStorage?: unknown }).localStorage;
    });

    it('the votes, the voter id and the tokens read nothing and throw nothing when the getter throws', () => {
        Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError: storage blocked'); } });
        expect(siteStorage()).toBeNull();
        expect(myVotes()).toEqual({});
        expect(voterId()).toMatch(/^[0-9a-f]{32}$/);
        expect(() => rememberVote('887f27aa-0000abcd', 1)).not.toThrow();
        expect(myTokens()).toEqual({});
        expect(() => rememberToken('887f27aa-0000abcd', 'a'.repeat(32))).not.toThrow();
    });

    it('control: a store whose getItem throws reads as empty too', () => {
        const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
        expect(myVotes(bad)).toEqual({});
        expect(voterId(bad)).toMatch(/^[0-9a-f]{32}$/);
    });
});

describe('TK-7 edit tokens across reloads', () => {
    it('a token is kept and read back, junk is dropped, the newest TOKENS_KEPT stay', () => {
        const s = memory();
        rememberToken('887f27aa-0000abcd', 'tok_' + 'x'.repeat(28), s);
        expect(myTokens(s)).toEqual({ '887f27aa-0000abcd': 'tok_' + 'x'.repeat(28) });
        s.setItem('gsfpv.course.tokens', JSON.stringify({ 'not an id': 'x'.repeat(32), '887f27aa-0000abce': 5, '887f27aa-0000abcf': 'short' }));
        expect(myTokens(s)).toEqual({});
        for (let i = 0; i < TOKENS_KEPT + 5; i++) rememberToken(`887f27aa-${i.toString(16).padStart(8, '0')}`, 'y'.repeat(32), s);
        const kept = Object.keys(myTokens(s));
        expect(kept.length).toBe(TOKENS_KEPT);
        expect(kept).not.toContain('887f27aa-00000000');
        expect(kept).toContain(`887f27aa-${(TOKENS_KEPT + 4).toString(16).padStart(8, '0')}`);
    });
});

describe('TK-5 the admin link names the version', () => {
    it('editorLink with a version reads back as id and version; without one the version is null', () => {
        const href = editorLink('en', '887f27aa', '887f27aa-830e1273', 3);
        const search = href.slice(href.indexOf('?'));
        expect(servedOfLink(search)).toEqual({ id: '887f27aa-830e1273', version: 3 });
        expect(serverOfLink(search)).toBe('887f27aa-830e1273');
        expect(servedOfLink('?course=887f27aa-830e1273')).toEqual({ id: '887f27aa-830e1273', version: null });
        expect(servedOfLink('?course=887f27aa-830e1273.v0')).toBeNull();
        expect(servedOfLink('?course=887f27aa-830e1273.vx')).toBeNull();
    });
});

describe('TK-3 keyboard path into the editor window', () => {
    const canvas = { typing: false, inWindow: false, onButton: false };
    const button = { typing: false, inWindow: true, onButton: true };
    const field = { typing: true, inWindow: true, onButton: false };

    it('Tab walks the window when the focus is in it and selects gates on the canvas', () => {
        expect(keyRoute({ code: 'Tab' }, button)).toBe('pass');
        expect(keyRoute({ code: 'Tab', shiftKey: true }, button)).toBe('pass');
        expect(keyRoute({ code: 'Tab' }, canvas)).toBe('edit');
    });

    it('Esc inside the window gives the focus back; on the canvas it is the editor key', () => {
        expect(keyRoute({ code: 'Escape' }, button)).toBe('blur');
        expect(keyRoute({ code: 'Escape' }, field)).toBe('blur');
        expect(keyRoute({ code: 'Escape' }, canvas)).toBe('edit');
    });

    it('F6 enters the window and has a key row; Enter clicks a button, saves in a field', () => {
        expect(keyRoute({ code: 'F6' }, canvas)).toBe('edit');
        expect(editorKey({ code: 'F6' }, [0, -1])).toEqual({ cmd: 'focus-window' });
        expect(KEY_ROWS.some((r) => r.press.code === 'F6')).toBe(true);
        expect(keyRoute({ code: 'Enter' }, button)).toBe('pass');
        expect(keyRoute({ code: 'Enter' }, field)).toBe('save');
        expect(keyRoute({ code: 'KeyA' }, field)).toBe('pass');
    });
});

describe('TK-12 two-click confirm of the admin', () => {
    it('the second click of a double click is ignored, a later one confirms', () => {
        expect(confirmStep(null, 0, 'delete:a', 1000)).toBe('ask');
        expect(confirmStep('delete:a', 1000, 'delete:a', 1000 + 120)).toBe('ignore');
        expect(confirmStep('delete:a', 1000, 'delete:a', 1000 + CONFIRM_GUARD_MS)).toBe('do');
        expect(confirmStep('delete:a', 1000, 'reset:a', 1050)).toBe('ask');
    });
});
