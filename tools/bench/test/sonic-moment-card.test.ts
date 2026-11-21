// Train 4, lane tutor-air S2 (decision 9 of the brief, for low-vision pilots): during a moment the screen shows one large
// high-contrast line, the sentence being spoken, and the sound's name, nothing else (apps/fly/src/sonic/moment-card.ts).
//  - the card holds exactly two things: the sound's name (the package's `cue.<id>.name`, never typed) and the last line spoken;
//  - it is aria-hidden (the line is announced once, through the captions) and leaves no live region;
//  - null hides it and gives the panels back (body class); a line spoken outside a moment never reaches it;
//  - every moment of the package's lessons has a name in the four languages, and the style has the large type, the short-screen
//    rule and the forced colours.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DICTS, lessonMoments, lessonsOnPath } from '../../../packages/sonic-fpv/src';
import type { CueId, MomentView } from '../../../packages/sonic-fpv/src';
import { MOMENT_BODY_CLASS, MomentCard } from '../../../apps/fly/src/sonic/moment-card';
import { FakeDocument } from './sonic-fake-dom';

const REPO = join(__dirname, '..', '..', '..');

function view(cue: CueId, phase: MomentView['phase']): MomentView {
    return { id: `m-${cue}`, cue, phase, form: null } as unknown as MomentView;
}

function rig() {
    const doc = new FakeDocument();
    const card = new MomentCard(doc as unknown as Document, doc.body as unknown as HTMLElement, (cue) => DICTS.en[`cue.${cue}.name`] ?? '?');
    const el = doc.body.querySelector('[data-testid="sonic-moment"]')!;
    return { doc, card, el };
}

describe('the moment card (decision 9)', () => {
    it('shows the sound\'s name and the sentence being spoken, nothing else; aria-hidden; null hides it and gives the panels back', () => {
        const { doc, card, el } = rig();
        expect(el).not.toBeNull();
        expect(el.hidden).toBe(true);
        expect(el.getAttribute('aria-hidden')).toBe('true');
        card.said('a line outside a moment');
        expect(el.textContent).toBe('');

        card.show(view('safety.wall' as CueId, 'what'));
        expect(card.shown).toBe(true);
        expect(doc.body.classList.contains(MOMENT_BODY_CLASS)).toBe(true);
        const sound = el.querySelector('[data-testid="sonic-moment-sound"]')!;
        const line = el.querySelector('[data-testid="sonic-moment-line"]')!;
        expect(sound.textContent).toBe(DICTS.en['cue.safety.wall.name']);
        expect(sound.textContent.length).toBeGreaterThan(0);
        expect(line.textContent).toBe('');
        card.said('This is the wall. It sounds when a wall is near.');
        card.said('   ');
        expect(line.textContent).toBe('This is the wall. It sounds when a wall is near.');
        // two children, no button, no live region
        expect(el.children).toHaveLength(2);
        expect(el.querySelectorAll('button, [aria-live], [role="status"], [role="alert"]')).toHaveLength(0);

        // the next phase of the same moment keeps the line; a new sound starts with an empty line
        card.show(view('safety.wall' as CueId, 'do'));
        expect(line.textContent).toBe('This is the wall. It sounds when a wall is near.');
        card.show(view('target.hum' as CueId, 'what'));
        expect(line.textContent).toBe('');
        expect(sound.textContent).toBe(DICTS.en['cue.target.hum.name']);

        card.show(null);
        expect(el.hidden).toBe(true);
        expect(doc.body.classList.contains(MOMENT_BODY_CLASS)).toBe(false);
        card.said('after');
        expect(line.textContent).toBe('');
        card.remove();
        expect(doc.body.querySelector('[data-testid="sonic-moment"]')).toBeNull();
    });

    it('every moment\'s sound has a name in en, es, pl and ru (the package\'s cue.<id>.name)', () => {
        const cues = new Set<string>();
        for (const l of lessonsOnPath('full')) for (const m of lessonMoments(l)) cues.add(m.cue);
        expect(cues.size).toBeGreaterThan(0);
        for (const loc of ['en', 'es', 'pl', 'ru'] as const) for (const c of cues) expect(DICTS[loc][`cue.${c}.name`], `${loc} ${c}`).toBeTruthy();
    });

    it('the style: large type, a rule for short screens (844x390), forced colours, the panels faded under it', () => {
        const css = readFileSync(join(REPO, 'apps', 'fly', 'src', 'sonic', 'sonic.css'), 'utf8');
        expect(css).toMatch(/\.sonic-moment-line \{[^}]*font-size: clamp\(26px/);
        expect(css).toMatch(/@media \(max-height: 500px\) \{[^\n]*\.sonic-moment-line/);
        expect(css).toMatch(/@media \(forced-colors: active\) \{[^\n]*\.sonic-moment/);
        expect(css).toContain(`body.${MOMENT_BODY_CLASS} .sonic-captions`);
    });
});
