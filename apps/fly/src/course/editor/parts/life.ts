// Lane edit4b, the course's life in the editor (design edit4 section 3; the owner's complaints E4, E5, E10): the Course
// menu's New empty course, Delete all gates, Generate new course and Overview, and the question before any step that drops
// the pilot's gates (Services.confirmLoss). Every step that drops work asks first; nothing here moves the camera.
import { t } from '../../../i18n';
import type { EditorSeam, LossQuestion, MenuItem } from '../seam';
import { askFirst } from './life-ask';
import { LIFE_LINES, LIFE_MENU, emptyCourse, lossText, type LifeMenuId } from './life-texts';
import './life.css';

/** What the pilot asked last and how it ended, for the page probes (seam.hook('b')) */
export interface LifeRecord {
    asked: LossQuestion | null;
    answer: boolean | null;
    did: LifeMenuId | null;
}

/** The question for a step that drops work, then the step: `go` runs only on Yes (or when nothing would be lost). */
export async function afterLoss(seam: Pick<EditorSeam, 'call'>, q: LossQuestion, go: () => void): Promise<boolean> {
    const yes = await seam.call('confirmLoss', q);
    if (yes) go();
    return yes;
}

export function install(seam: EditorSeam): () => void {
    const rec: LifeRecord = { asked: null, answer: null, did: null };
    const report = (): void => seam.hook('b', { life: { ...rec } });
    seam.provide('confirmLoss', async (q) => {
        const text = lossText(q);
        if (!text) return true;
        rec.asked = q;
        rec.answer = null;
        report();
        const yes = await askFirst(text);
        rec.answer = yes;
        report();
        if (!yes) seam.say(t(LIFE_LINES.kept), 'did');
        return yes;
    });
    const question = (what: LossQuestion['what']): LossQuestion => {
        const st = seam.state();
        const gates = st?.course.gates.length ?? 0;
        return { what, gates, unsaved: gates > 0 && changedSinceSave };
    };
    // whether the gates changed since the editor opened or the course was saved (a fresh generated course counts as kept)
    let changedSinceSave = false;
    const offs = [
        seam.on('changed', (e) => { changedSinceSave = e.by !== 'generate' && e.by !== 'new'; }),
        seam.on('opened', () => { changedSinceSave = false; }),
        seam.on('saved', () => { changedSinceSave = false; })
    ];
    const did = (id: LifeMenuId): void => {
        rec.did = id;
        report();
    };
    const runs: Record<LifeMenuId, () => void> = {
        new: () => void afterLoss(seam, question('new'), () => {
            seam.startNew(emptyCourse(seam.trackNow(), t(LIFE_LINES.newTitle), seam.flown()));
            did('new');
        }),
        clear: () => {
            const st = seam.state();
            if (!st || st.course.gates.length === 0) return seam.say(t(LIFE_LINES.empty), 'did');
            void afterLoss(seam, { what: 'clear', gates: st.course.gates.length, unsaved: true }, () => {
                seam.replace([], 'clear', -1);
                did('clear');
            });
        },
        // the owner (brief 555): a pressed Generate never drops his gates without a question
        generate: () => void afterLoss(seam, question('generate'), () => {
            seam.generate(null);
            did('generate');
        }),
        overview: () => {
            seam.call('frameAll');
            did('overview');
        }
    };
    const items: MenuItem[] = LIFE_MENU.map((m) => ({ id: m.id, labelKey: m.labelKey, run: runs[m.id] }));
    seam.menu('course', items);
    report();
    return () => { for (const o of offs) o(); };
}
