// The site's two build steps for the scene pages and the landing's catalogue (docs/wip/v07-a.md 2 and 4):
// scripts/scene-templates.mjs (a Next page -> an API template: scripts out, slots checked against
// apps/api/scene-slots.json) and scripts/catalog-snapshot.mjs (the catalogue snapshot). Each block ends with
// a negative control that must fire.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM build scripts without type declarations
import { checkTemplate, stripPage } from '../scripts/scene-templates.mjs';
// @ts-expect-error plain ESM build scripts without type declarations
import { asciiJson, snapshotOf } from '../scripts/catalog-snapshot.mjs';

const BUILT = join(__dirname, '..', 'out', 'scene-templates');
const NEXT_PAGE = `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><link rel="preload" as="script" fetchPriority="low" href="/_next/static/chunks/a.js"/>
<meta name="gsfpv-head" content="slot"/></head><body><!--$--><h1>{{h1}}</h1><a href="{{flyHref}}">fly</a><a href="{{originUrl}}">o</a><img src="{{poster}}"/>
<p>{{summary}}</p><dl>[[#facts]]<dt>{{k}}</dt><dd>{{v}}</dd>[[/facts]]</dl>[[#faq]]{{q}}{{a}}[[/faq]][[#share]]<a href="{{href}}">{{label}}</a>[[/share]]
{{authorName}}<!-- -->{{license}}<script src="/_next/static/chunks/b.js" async=""></script><script>self.__next_f.push([1,"x"])</script>
<script type="application/ld+json">{{{jsonld}}}</script></body></html>`;

describe('scene-templates: a Next page becomes an API template', () => {
    it('drops every executable script and preload, keeps the JSON-LD, marks head and lang', () => {
        const t = stripPage(NEXT_PAGE);
        expect(t).not.toContain('__next_f');
        expect(t).not.toContain('b.js');
        expect(t).not.toContain('a.js');
        expect(t).not.toContain('<!--');
        expect(t).toContain('<script type="application/ld+json">{{{jsonld}}}</script>');
        expect(t).toContain('<html lang="{{lang}}"');
        expect(t).toContain('{{{head}}}');
        expect(checkTemplate(t, 'scene')).toEqual([]);
        // control: the page as Next wrote it fails the same check
        expect(checkTemplate(NEXT_PAGE, 'scene')).toEqual(expect.arrayContaining(['executable script left: 2', 'no head slot (the gsfpv-head meta was not found)']));
    });

    it('refuses unknown, missing, raw or unbalanced slots and inline code the CSP would block', () => {
        const ok = stripPage(NEXT_PAGE);
        expect(checkTemplate(ok.replace('{{summary}}', '{{summary}}{{secret}}'), 'scene')).toContain('unknown slot: secret');
        expect(checkTemplate(ok.replace('{{summary}}', ''), 'scene')).toContain('missing slot: summary');
        expect(checkTemplate(ok.replace('{{summary}}', '{{{summary}}}'), 'scene')).toContain('raw slot not allowed: summary');
        expect(checkTemplate(ok.replace('[[/facts]]', ''), 'scene')).toContain('never closed: facts');
        expect(checkTemplate(ok.replace('<h1>', '<h1 style="color:red">'), 'scene')[0]).toMatch(/inline style/);
        expect(checkTemplate(ok.replace('<h1>', '<h1 onclick="x()">'), 'scene')).toContain('inline event handler');
        expect(checkTemplate(ok, 'index')).toEqual(expect.arrayContaining(['missing slot: cards']));
    });

    it.skipIf(!existsSync(join(BUILT, 'manifest.json')))('the built templates pass (out/scene-templates, after pnpm --filter @gsfpv/site build)', () => {
        for (const lang of ['en', 'es', 'pl', 'ru']) {
            for (const kind of ['scene', 'index']) expect(checkTemplate(readFileSync(join(BUILT, `${kind}.${lang}.html`), 'utf8'), kind), `${kind}.${lang}`).toEqual([]);
        }
        expect(existsSync(join(__dirname, '..', 'out', 'scene-template'))).toBe(false); // the raw route is gone from out/
    });
});

describe('catalog-snapshot', () => {
    const doc = { published: '2026-10-07T17:04:42Z', collections: [], scenes: [{ id: '70b50d42', title: 'Wroc\u0142aw Cathedral' }, { id: 'aaaaaa01', title: 'H', hidden: true }] };

    it('keeps a catalogue, leaves hidden scenes out, writes ASCII only with the same data', () => {
        const s = snapshotOf(doc);
        expect(s.scenes.map((x: { id: string }) => x.id)).toEqual(['70b50d42']);
        const text = asciiJson(s);
        expect(/^[\x20-\x7e\n]*$/.test(text)).toBe(true);
        expect(JSON.parse(text).scenes[0].title).toBe('Wroc\u0142aw Cathedral');
        // control: plain JSON.stringify writes the letter itself (check B18 would flag the file)
        expect(/^[\x20-\x7e\n]*$/.test(JSON.stringify(s))).toBe(false);
    });

    it('refuses what is not a catalogue (the committed snapshot is kept then)', () => {
        for (const bad of [null, {}, { scenes: [] }, { scenes: [{ id: '../x', title: 'a' }] }, { scenes: [{ id: 'abcdef12' }] }, '<!doctype html>']) {
            expect(snapshotOf(bad)).toBeNull();
        }
        expect(snapshotOf({ scenes: [{ id: 'abcdef12', title: 'ok' }] })).not.toBeNull(); // control
    });

    it('the committed snapshot is a catalogue', () => {
        expect(snapshotOf(JSON.parse(readFileSync(join(__dirname, '..', 'src', 'generated', 'catalog.json'), 'utf8')))).not.toBeNull();
    });

    it('the build (prebuild, no flag) asks no server: a build depends on the commit alone; --refresh does ask (control)', async () => {
        const file = join(__dirname, '..', 'src', 'generated', 'catalog.json');
        const before = readFileSync(file, 'utf8');
        let hits = 0;
        // answers something that is not a catalogue, so even the --refresh run keeps the committed file
        const server = createServer((_req, res) => { hits++; res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"scenes":[]}'); });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/catalog`;
        const run = (...args: string[]) => promisify(execFile)(process.execPath, [join(__dirname, '..', 'scripts', 'catalog-snapshot.mjs'), ...args], { env: { ...process.env, CATALOG_URL: url } });
        try {
            await run();
            expect(hits).toBe(0);
            await run('--refresh');
            expect(hits).toBe(1);
        } finally {
            server.close();
        }
        expect(readFileSync(file, 'utf8')).toBe(before);
    });
});
