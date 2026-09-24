// B18: the public repository as a visitor and a search engine see it. Token for the API comes from
// the local git credential store and is never printed.
//   npx tsx src/accept-repo.ts
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeEvidence, REPO } from './evidence';

const OWNER_REPO = 'AndriiShramko/ShramkoGSFPV';
const SITE = 'https://gsfpv.flyreelstudio.eu';
const token = (() => {
    const out = execSync('git credential fill', { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
    return out.split('\n').find((l) => l.startsWith('password='))!.slice(9);
})();
const gh = async (path: string) => {
    const r = await fetch(`https://api.github.com${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gsfpv-accept' } });
    return { status: r.status, json: r.status === 200 ? await r.json() : null };
};

const repo = (await gh(`/repos/${OWNER_REPO}`)).json as Record<string, unknown>;
const protection = await gh(`/repos/${OWNER_REPO}/branches/main/protection`);
const readme = readFileSync(join(REPO, 'README.md'), 'utf8');
const imgs = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);
const imgFiles = imgs.filter((p) => !/^https?:/.test(p)).map((p) => ({ p, exists: existsSync(join(REPO, p)) }));
const siteLink = readme.includes(SITE);
const siteStatus = (await fetch(`${SITE}/?cb=${Date.now()}`, { redirect: 'follow' })).status;
const files = ['NOTICE', 'CITATION.cff', 'AGENTS.md', 'AGENT_SETUP.md', 'llms.txt', 'SECURITY.md', 'docs/warnings.md', 'docs/PROVENANCE.md', 'LICENSE'].map((f) => ({ f, exists: existsSync(join(REPO, f)) }));
const cff = readFileSync(join(REPO, 'CITATION.cff'), 'utf8');
const cffOk = ['cff-version:', 'message:', 'title:', 'authors:', 'family-names:', 'license: MIT'].every((k) => cff.includes(k));
// Cyrillic and Polish letters outside locales/ in tracked text files
const tracked = execSync('git ls-files', { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
// built from code points so this file itself stays free of the letters it looks for
const cc = (...codes: number[]) => String.fromCharCode(...codes);
const LETTERS = new RegExp('[' + cc(0x400) + '-' + cc(0x4ff) + cc(0x104) + '-' + cc(0x107) + cc(0x118, 0x119) + cc(0x141) + '-' + cc(0x144) + cc(0x15a, 0x15b) + cc(0x179) + '-' + cc(0x17c) + ']');
const outside = tracked.filter((f) => !f.includes('locales/') && /\.(md|txt|json|ts|tsx|mjs|js|css|html|yml|yaml|cff|py|sh|toml)$/.test(f)).filter((f) => { try { return LETTERS.test(readFileSync(join(REPO, f), 'utf8')); } catch { return false; } });
// placeholders in the docs a visitor reads
const docs = tracked.filter((f) => /\.(md|txt|cff)$/.test(f) && !f.startsWith('evidence/'));
const placeholders = docs.filter((f) => /\bTODO\b|\bPLACEHOLDER\b|[Ll]orem ipsum|\bundefined\b|\{\{[^}]+\}\}/.test(readFileSync(join(REPO, f), 'utf8')));
const topics = (repo.topics as string[]) ?? [];
const prot = protection.json as { allow_force_pushes?: { enabled: boolean }; required_status_checks?: { contexts: string[] } } | null;
const pass = repo.private === false && !!repo.description && topics.length >= 8 && (repo.license as { spdx_id: string })?.spdx_id === 'MIT' && repo.homepage === SITE
    && siteLink && siteStatus === 200 && imgFiles.length > 0 && imgFiles.every((x) => x.exists) && files.every((x) => x.exists) && cffOk && outside.length === 0 && placeholders.length === 0
    && protection.status === 200 && prot?.allow_force_pushes?.enabled === false;
writeEvidence('b-repo-b18', {
    pass,
    repo: { private: repo.private, description: repo.description, topics, license: (repo.license as { spdx_id: string })?.spdx_id, homepage: repo.homepage },
    readme: { siteLink, siteStatus, screenshots: imgFiles },
    files, citationCffValid: cffOk,
    cyrillicOrPolishOutsideLocales: outside,
    placeholdersInDocs: placeholders,
    mainProtection: { status: protection.status, forcePushAllowed: prot?.allow_force_pushes?.enabled, requiredChecks: prot?.required_status_checks?.contexts },
    control: { readmeLinkToSiteAnswers: siteStatus }
});
console.log(`B18 ${pass ? 'PASS' : 'FAIL'}`, JSON.stringify({ outside, placeholders, topics: topics.length }));
