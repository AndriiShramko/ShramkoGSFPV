// Why an action of the helper's panel failed (v0.12 v12-int step 9; docs/wip/v12-feedback-review.md, "Left open" 5). The registry (registry.ts: keep,
// pack, delete) used to throw English sentences, and the panel put them into "Could not save: {reason}", so a Spanish, Polish or Russian helper read
// English in the middle of a sentence of his language. The rule is that a text for a person lives only in the dictionaries (packages/i18n/locales,
// en es pl ru): the registry now throws a CODE (RegistryError) and the panel says it with the sentence of that code. What stays as it came is the
// TECHNICAL text of the browser (a DOMException's message of a failure nobody foresaw) is the `{detail}` of the general sentence, as in the recorder's
// own problems (`sonicrec.error.*`, review F5). The sound package's own diagnostic of a recording it cannot pack ("voice.webm has 1154 bytes, the
// manifest says 3205") is English only: it is kept in the error for the console and not put into a sentence of the page's language.
//
// No DOM and no texts here, so Node tests run it.

export type ReasonCode = 'locked' | 'cannot-pack' | 'recover';

/** The details each code gives its sentence (`sonicrec.reason.<code>`), named as the sentence names them: the test holds the dictionaries to this. */
export const REASON_PARAMS: Readonly<Record<ReasonCode | 'other', readonly string[]>> = {
    locked: [],
    'cannot-pack': [],
    recover: [],
    other: ['detail']
};

/** A registry action that cannot be done, by code. `detail` and `message` are for the console and a log, never for a person. */
export class RegistryError extends Error {
    constructor(
        readonly code: ReasonCode,
        readonly detail: string = ''
    ) {
        super(detail === '' ? code : `${code}: ${detail}`);
        this.name = 'RegistryError';
    }
}

/** The dictionary key and details that say why `e` happened: a RegistryError by its code, anything else (a browser's or the package's own text) as the detail of a general sentence. */
export function reasonOf(e: unknown): { readonly key: string; readonly params: Record<string, string> } {
    if (e instanceof RegistryError) return { key: `sonicrec.reason.${e.code}`, params: REASON_PARAMS[e.code].includes('detail') ? { detail: e.detail === '' ? '-' : e.detail } : {} };
    return { key: 'sonicrec.reason.other', params: { detail: e instanceof Error ? e.message : String(e) } };
}
