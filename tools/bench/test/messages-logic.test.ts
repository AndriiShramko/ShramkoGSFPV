// Lane ux4a (complaint U1): the rules of the one message service (apps/fly/src/messages-logic.ts), no page.
import { describe, expect, it } from 'vitest';
import { LOG_SIZE, MAX_SHOWN_MS, MIN_SHOWN_MS, MessageLog, messagePlace, PROGRESS_IDLE_MS, reportText, shownMs } from '../../../apps/fly/src/messages-logic';

describe('messages: how long a line stays', () => {
    it('a longer text stays longer', () => {
        const short = shownMs({ text: 'Walls on' });
        const long = shownMs({ text: 'The course could not be built here: the scan has no open space wide enough for a gate.' });
        expect(long).toBeGreaterThan(short);
    });
    it('every info or done line stays between 4 and 15 seconds', () => {
        for (const n of [0, 1, 10, 30, 60, 100, 200, 1000]) {
            for (const kind of ['info', 'done'] as const) {
                const ms = shownMs({ text: 'x'.repeat(n), kind });
                expect(ms).toBeGreaterThanOrEqual(MIN_SHOWN_MS);
                expect(ms).toBeLessThanOrEqual(MAX_SHOWN_MS);
            }
        }
        expect(shownMs({ text: '' })).toBe(MIN_SHOWN_MS);
        expect(shownMs({ text: 'x'.repeat(1000) })).toBe(MAX_SHOWN_MS);
    });
    it('a problem stays until it is closed', () => {
        expect(shownMs({ text: 'Failed', kind: 'problem' })).toBe(Infinity);
        const log = new MessageLog();
        const p = log.add({ text: 'Failed', kind: 'problem', fix: 'Try again' }, 0);
        expect(log.visible(3_600_000).lines.map((e) => e.id)).toEqual([p.id]);
        log.close(p.id);
        expect(log.visible(3_600_001).lines).toEqual([]);
        expect(log.all()[0].text).toBe('Failed');
    });
    it('a progress line leaves 8 s after its last update', () => {
        const log = new MessageLog();
        log.add({ text: '10 %', kind: 'progress', key: 'course.progress' }, 0);
        log.add({ text: '50 %', kind: 'progress', key: 'course.progress' }, 5000);
        expect(log.visible(5000 + PROGRESS_IDLE_MS - 1).lines).toHaveLength(1);
        expect(log.visible(5000 + PROGRESS_IDLE_MS + 1).lines).toHaveLength(0);
    });
});

describe('messages: the log', () => {
    it('a message with the same key replaces the line in place', () => {
        const log = new MessageLog();
        const a = log.add({ text: 'Building the course: 10 %', kind: 'progress', key: 'course.progress' }, 0);
        log.add({ text: 'Walls on' }, 100);
        const b = log.add({ text: 'Building the course: 60 %', kind: 'progress', key: 'course.progress' }, 200);
        expect(b.id).toBe(a.id);
        const lines = log.visible(300).lines;
        expect(lines.filter((e) => e.key === 'course.progress')).toHaveLength(1);
        expect(lines.find((e) => e.key === 'course.progress')?.text).toBe('Building the course: 60 %');
        const done = log.add({ text: 'Course ready', kind: 'done', key: 'course.progress' }, 400);
        expect(done.id).toBe(a.id);
        expect(log.visible(500).lines.find((e) => e.id === a.id)?.kind).toBe('done');
    });
    it('the same text twice is one line', () => {
        const log = new MessageLog();
        log.add({ text: 'Walls on' }, 0);
        log.add({ text: 'Walls on' }, 10);
        expect(log.visible(20).lines).toHaveLength(1);
    });
    it('keeps the last 50', () => {
        const log = new MessageLog();
        for (let i = 0; i < 70; i++) log.add({ text: `m${i}` }, i);
        const all = log.all();
        expect(all).toHaveLength(LOG_SIZE);
        expect(all[0].text).toBe('m69');
        expect(all[LOG_SIZE - 1].text).toBe('m20');
    });
    it('shows at most 3 lines, problems first, and counts the rest', () => {
        const log = new MessageLog();
        log.add({ text: 'a' }, 0);
        log.add({ text: 'P1', kind: 'problem' }, 1);
        log.add({ text: 'b' }, 2);
        log.add({ text: 'c' }, 3);
        log.add({ text: 'P2', kind: 'problem' }, 4);
        const v = log.visible(5);
        expect(v.lines.map((e) => e.text)).toEqual(['P2', 'P1', 'c']);
        expect(v.more).toBe(2);
    });
    it('a paused line does not leave; after the pointer leaves its time runs on', () => {
        const log = new MessageLog();
        const e = log.add({ text: 'Walls on' }, 0);
        const ms = shownMs({ text: 'Walls on' });
        log.pause(e.id, ms - 500);
        expect(log.visible(ms + 60_000).lines).toHaveLength(1);
        log.resume(e.id, ms + 60_000);
        expect(log.visible(ms + 60_000 + 900).lines).toHaveLength(1);
        expect(log.visible(ms + 60_000 + 1001).lines).toHaveLength(0);
    });
    it('counts unread problems until the list is opened or the line closed', () => {
        const log = new MessageLog();
        const p = log.add({ text: 'P1', kind: 'problem' }, 0);
        log.add({ text: 'P2', kind: 'problem' }, 1);
        log.add({ text: 'info' }, 2);
        expect(log.unreadProblems()).toBe(2);
        log.close(p.id);
        expect(log.unreadProblems()).toBe(1);
        log.markRead();
        expect(log.unreadProblems()).toBe(0);
    });
    it('the next change is the first line to leave', () => {
        const log = new MessageLog();
        log.add({ text: 'P', kind: 'problem' }, 0);
        expect(log.nextChange(0)).toBe(Infinity);
        log.add({ text: 'hello' }, 100);
        expect(log.nextChange(100)).toBe(100 + shownMs({ text: 'hello' }));
    });
    it('the place: top centre above a third of the height on a laptop, the left third on a phone on its side', () => {
        expect(messagePlace(1536, 730)).toEqual({ side: false, maxBottom: 243 });
        expect(messagePlace(1366, 768)).toEqual({ side: false, maxBottom: 256 });
        expect(messagePlace(844, 390)).toEqual({ side: true, maxBottom: 234 });
        expect(messagePlace(1200, 450).side).toBe(true);
    });
    it('the report carries the text, what to do, the feature and the scene', () => {
        expect(reportText({ text: 'Failed', fix: 'Try again', from: 'course', scene: '70b50d42' })).toBe('Failed\nTry again\nfrom: course\nscene: 70b50d42');
    });
    it('a problem replaced by a new progress line under its key stays in the list as it was', () => {
        const log = new MessageLog();
        const p = log.add({ text: 'No course fits', kind: 'problem', key: 'course.progress', from: 'course' }, 0);
        const n = log.add({ text: 'Building the course: 5 %', kind: 'progress', key: 'course.progress' }, 1000);
        expect(n.id).not.toBe(p.id);
        expect(log.visible(1100).lines.map((e) => e.text)).toEqual(['Building the course: 5 %']);
        expect(log.all().map((e) => `${e.kind}:${e.text}`)).toEqual(['progress:Building the course: 5 %', 'problem:No course fits']);
    });
});
