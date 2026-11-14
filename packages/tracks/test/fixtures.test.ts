// The TS twin of the server's validator agrees with it on every shared fixture (train 1 plan section 3, T3): the files
// apps/api/tests/fixtures/tracks/valid-*.json pass validateServerTrack and invalid-*.json fail it, as apps/api/tests/test_tracks.py
// proves for tracks.py validate_track. Control: the generator's own course passes, and the same course with one contract field
// changed (author.kind 'person', a valid track for the sound package) fails only here, not in validateTrack.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateTrack } from '@shramko/sonic-fpv';
import { parseServerTrack, validateServerTrack, generateCourse, freeSpace } from '../src';
import { IDENTITY, SPAWN_A, threeRooms } from './worlds';

const DIR = join(__dirname, '..', '..', '..', 'apps', 'api', 'tests', 'fixtures', 'tracks');
const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();

describe('server track fixtures', () => {
    it('has both kinds', () => {
        expect(files.filter((f) => f.startsWith('valid-')).length).toBeGreaterThanOrEqual(3);
        expect(files.filter((f) => f.startsWith('invalid-')).length).toBeGreaterThanOrEqual(20);
    });
    for (const f of files) {
        it(f, () => {
            const r = parseServerTrack(readFileSync(join(DIR, f), 'utf8'));
            if (f.startsWith('valid-')) expect(r.ok ? [] : r.issues).toEqual([]);
            else expect(r.ok, `${f} must be refused`).toBe(false);
        });
    }
    it('control: a generated course passes; with author.kind agent the format accepts it and the contract does not', () => {
        const walls = threeRooms();
        const free = freeSpace(walls, { spawn: SPAWN_A });
        const track = generateCourse(free, walls, { seed: 7, scene: { id: '39e63ce9', version: 1 }, transform: IDENTITY });
        expect(track.gates.length).toBeGreaterThan(0);
        const own = validateServerTrack(JSON.parse(JSON.stringify(track)));
        expect(own.ok ? [] : own.issues).toEqual([]);
        const agent = { ...JSON.parse(JSON.stringify(track)), author: { kind: 'agent', name: 'Ann' } };
        expect(validateTrack(agent).ok).toBe(true);
        expect(validateServerTrack(agent).ok).toBe(false);
        // a pilot's edit (tracks-plan 2.6): the name the pilot typed and a title of its own pass; a web address does not
        const person = { ...JSON.parse(JSON.stringify(track)), author: { kind: 'person', name: 'Ann' }, title: "Ann's loop", generator: null };
        const mine = validateServerTrack(person);
        expect(mine.ok ? [] : mine.issues).toEqual([]);
        expect(validateServerTrack({ ...person, author: { kind: 'person', name: 'www.spam.pl' } }).ok).toBe(false);
    });
});
