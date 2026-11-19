// Lane site4: every page's main button leads where the page promises (docs/wip/site4.md, the audit table).
// mainCta: the sound pages start Fly by Sound; langHref: a language switch keeps the anchor; consentDock: the cookie banner
// never lies over the page's main button (/es/sound/ at 320 px, the start button under the banner on origin/main).
import { describe, expect, it } from 'vitest';
import { mainCta, soundStartPath } from '../src/config/site';
import { langHref } from '../src/lib/lang-href';
import { consentDock } from '../src/lib/consent-dock';

describe('mainCta', () => {
  it('the sound kind opens the sound start, the same address as the sound page start button', () => {
    for (const l of ['en', 'es', 'pl', 'ru']) {
      const c = mainCta(l, 'sound');
      expect(c.kind).toBe('sound');
      expect(c.href).toBe(soundStartPath(l));
      expect(c.href.startsWith(`/${l}/fly/?`)).toBe(true);
      expect(new URLSearchParams(c.href.split('?')[1]).get('sonic')).toBe('start');
    }
  });
  it('the default is the picker, a given address wins (a scene page flies that scene)', () => {
    expect(mainCta('pl')).toEqual({ kind: 'fly', href: '/pl/fly/' });
    expect(mainCta('en', 'fly', '/en/fly/?scene=39e63ce9').href).toBe('/en/fly/?scene=39e63ce9');
  });
});

describe('langHref', () => {
  it('carries the current anchor to the other language', () => {
    expect(langHref('https://x.eu/pl/sound/', '#sound-keys')).toBe('https://x.eu/pl/sound/#sound-keys');
    expect(langHref('/pl/sound/#old', '#sound-who')).toBe('/pl/sound/#sound-who');
  });
  it('leaves the link alone without an anchor', () => {
    expect(langHref('/pl/sound/', '')).toBe('/pl/sound/');
    expect(langHref('/pl/sound/', '#')).toBe('/pl/sound/');
  });
});

describe('consentDock', () => {
  // the measured case of the audit: /es/sound/ at 320x568, banner 190 px tall, 80 px above the bottom, start button y 405..453
  it('docks under the header when at the bottom it would cover the main button', () => {
    expect(consentDock(568, 190, 80, 72, [{ top: 405, bottom: 453 }])).toBe('top');
  });
  it('stays at the bottom when the button is clear or off the screen', () => {
    expect(consentDock(568, 190, 80, 72, [{ top: 100, bottom: 148 }])).toBe('bottom');
    expect(consentDock(568, 190, 80, 72, [{ top: 900, bottom: 948 }])).toBe('bottom');
    expect(consentDock(568, 190, 80, 72, [])).toBe('bottom');
  });
  it('stays at the bottom when both places cover a button', () => {
    expect(consentDock(568, 190, 80, 72, [{ top: 100, bottom: 148 }, { top: 405, bottom: 453 }])).toBe('bottom');
  });
});
