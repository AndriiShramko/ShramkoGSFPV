// The mode's texts (packages/i18n/locales/fly/sonic: the start screen, its notes, the page's spoken lines; sonickeys: the names of the
// keys that exist only in the mode) come with the start chunk instead of the simulator's main one (v12-optin, the way
// sonic-session/texts.ts brings the recorder's): lazy-start.ts imports this file first, so the strings are in t()'s dictionaries
// before the start screen draws, and a page without ?sonic= never downloads them. Every page keeps sonicentry (i18n.ts).
import { addDictionaries } from '../i18n';

addDictionaries(import.meta.glob<Record<string, string>>(['../../../../packages/i18n/locales/fly/sonic/*.json', '../../../../packages/i18n/locales/fly/sonickeys/*.json'], { eager: true, import: 'default' }));
