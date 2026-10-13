// SuperSplat's facts in the admin (src/facts.ts): the server's answer (shaped as apps/api/superspl_facts.py
// sends it for the recorded scene 0230d903), what a refresh would change and how it applies. Each block
// ends with a negative control that must fire.
import { describe, expect, it } from 'vitest';
import { applyFacts, entryFromFacts, factChanges, readFacts } from '../src/facts';
import { readScene } from '../src/catalog';

const ANSWER = {
    ok: true, id: '0230d903', walkable: false, licenseCode: 'by', fetchedAt: '2026-10-13T09:00:00Z',
    facts: {
        id: '0230d903', title: 'Muster Truck Show Opole Poland 2024', author: 'Andrii Shramko', license: 'CC BY 4.0', version: 1,
        origin: { url: 'https://superspl.at/scene/0230d903', created: '2026-10-07T13:31:29Z', user: 'andriishramko' },
        thumb: 'https://s3-eu-west-1.amazonaws.com/images.playcanvas.com/splat/0230d903/v1/m.webp', format: 'ssog', sizeMb: 1559, collision: false
    }
};
// the entry as the owner added it by link in v0.6: no licence, no origin
const ENTRY = readScene({ id: '0230d903', title: 'Muster Truck Show', author: 'Andrii Shramko', license: '', kind: 'exterior', collision: false, version: 1, pinned: true })!;

describe('readFacts', () => {
    it('reads the server answer, keeps only catalogue-shaped fields', () => {
        const f = readFacts(ANSWER)!;
        expect(f.walkable).toBe(false);
        expect(f.facts.license).toBe('CC BY 4.0');
        expect(f.facts.collision).toBe(false);
        expect(f.facts.origin?.user).toBe('andriishramko');
        const junk = readFacts({ ...ANSWER, facts: { ...ANSWER.facts, thumb: 'javascript:alert(1)', evil: 1, origin: { url: 'https://evil.example/x' } } })!;
        expect(junk.facts.thumb).toBeUndefined();
        expect(junk.facts.origin).toBeUndefined();
        expect('evil' in junk.facts).toBe(false);
        // control: not an answer at all
        expect(readFacts({ ok: false, reason: 'busy' })).toBeNull();
        expect(readFacts({ ...ANSWER, id: '../x' })).toBeNull();
    });
});

describe('refresh from SuperSplat', () => {
    it('lists what differs and applies only the ticked fields, the rest of the entry untouched', () => {
        const f = readFacts(ANSWER)!;
        const changes = factChanges(ENTRY, f);
        expect(changes.map((c) => c.field)).toEqual(['title', 'license', 'thumb', 'format', 'sizeMb', 'origin']);
        const next = applyFacts(ENTRY, f, ['license', 'origin']);
        expect(next.license).toBe('CC BY 4.0');
        expect(next.origin?.url).toBe('https://superspl.at/scene/0230d903');
        expect(next.title).toBe('Muster Truck Show'); // not ticked: the owner's own title stays
        expect(next.pinned).toBe(true);
        expect(next.kind).toBe('exterior');
        // control: after applying everything there is nothing left to refresh
        expect(factChanges(applyFacts(ENTRY, f, changes.map((c) => c.field)), f)).toEqual([]);
    });

    it('a new entry from the facts: walls as the CDN said, kind left for the owner', () => {
        const e = entryFromFacts(readFacts(ANSWER)!);
        expect(e).toMatchObject({ id: '0230d903', title: 'Muster Truck Show Opole Poland 2024', license: 'CC BY 4.0', collision: false, kind: 'other', format: 'ssog' });
        // control: walls unknown (the CDN did not answer) is not "no walls"
        expect(entryFromFacts(readFacts({ ...ANSWER, walkable: null, facts: { ...ANSWER.facts, collision: undefined } })!).collision).toBe(true);
    });
});
