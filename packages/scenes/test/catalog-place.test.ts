// v0.7 contract of the catalogue (src/catalog.ts, the same rules as apps/api/admin.py _place_fields):
// where the place is, the compass heading, the wind, the collision ceiling, SuperSplat's drawing
// parameters, our words for the scene's page and what SuperSplat said. Out of range = dropped.
import { describe, expect, it } from 'vitest';
import { readScene } from '../src/catalog';

const base = { id: '70b50d42', title: 'Wroclaw Cathedral' };

describe('readScene v0.7 fields', () => {
    it('keeps every field in range', () => {
        const s = readScene({
            ...base,
            geo: { lat: 51.114, lon: 17.046, place: 'Wroclaw, Poland' },
            compassDeg: 90,
            wind: { fromDeg: 270, speed: 4.5, gust: 2, source: 'climate' },
            ceilingM: 35,
            render: { budgetM: 8, stochastic: true },
            about: { en: 'Fly between the towers', pl: 'Lec miedzy wiezami' },
            origin: { url: 'https://superspl.at/scene/70b50d42', description: 'A scan', tags: ['church', 'city'], created: '2026-09-30' }
        })!;
        expect(s.geo).toEqual({ lat: 51.114, lon: 17.046, place: 'Wroclaw, Poland' });
        expect(s.compassDeg).toBe(90);
        expect(s.wind).toEqual({ fromDeg: 270, speed: 4.5, gust: 2, source: 'climate' });
        expect(s.ceilingM).toBe(35);
        expect(s.render).toEqual({ budgetM: 8, stochastic: true });
        expect(s.about).toEqual({ en: 'Fly between the towers', pl: 'Lec miedzy wiezami' });
        expect(s.origin).toEqual({ url: 'https://superspl.at/scene/70b50d42', description: 'A scan', tags: ['church', 'city'], created: '2026-09-30' });
    });
    it('drops what is out of range or not from SuperSplat (controls)', () => {
        const s = readScene({
            ...base,
            geo: { lat: 91, lon: 17 },
            compassDeg: 400,
            wind: { fromDeg: 10, speed: 50, gust: 1 },
            ceilingM: 'high',
            render: { budgetM: 100, stochastic: 'yes' },
            origin: { url: 'https://evil.example/scene/1' }
        })!;
        expect(s).toEqual({ id: '70b50d42', title: 'Wroclaw Cathedral', author: '', license: '', kind: 'other', collision: true });
    });
    it('a wind without a source is the admin\'s', () => {
        expect(readScene({ ...base, wind: { fromDeg: 0, speed: 3, gust: 0 } })!.wind).toEqual({ fromDeg: 0, speed: 3, gust: 0, source: 'manual' });
    });
});
