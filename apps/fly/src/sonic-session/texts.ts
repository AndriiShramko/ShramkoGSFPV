// The recorder's texts (packages/i18n/locales/fly/sonicrec, about 54 KB in four languages) come with the session side's lazy chunk
// instead of the simulator's main one (v12-int step 4): every module of this folder that calls t() imports this file first, so the
// strings are in t()'s dictionaries before any of them is read, and a page without Fly by Sound never downloads them.
import { addDictionaries } from '../i18n';

addDictionaries(import.meta.glob<Record<string, string>>('../../../../packages/i18n/locales/fly/sonicrec/*.json', { eager: true, import: 'default' }));
