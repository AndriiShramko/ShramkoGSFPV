"""Count values from the private sensitive-data note that ever reached this repository's git history.

  GSFPV_SENSITIVE_NOTE=<path to the note> python tools/secret-values.py [--repo <dir>] [--control]

The note lives outside the repo (in the owner's vault) and is never read into the output: the
script prints counts only and, for a value found in history, the label of its table row plus a
masked value (first 4 characters + length). Candidates:
  - backtick values of >= 10 characters without spaces
  - table cells of >= 16 characters that contain both letters and digits
URLs, file paths and e-mail addresses are skipped (public or not secret by themselves); the
skipped ones are counted per reason, so a short value (an SSH port) or a path is visibly "not
scanned" rather than silently "not found".
History = `git log --all -p` (every ref, every patch) plus the files tracked right now.
--control plants a random fake token in a throw-away repo first and fails unless it is found.
"""
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile

URL = re.compile(r'^(https?://|www\.|ftp://|ssh://|git@)', re.I)
EMAIL = re.compile(r'^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$')
# absolute, home or drive paths, anything with a backslash, and relative paths ending in a file
# extension (a bare a/b token may be base64, so it stays a candidate)
PATH = re.compile(r'^(/|~|\.{1,2}/|[A-Za-z]:[\\/])|\\|^[\w.-]+(/[\w.-]+)+\.[A-Za-z0-9]{1,6}$')
# a bare name.ext such as config.env (named in the repo on purpose) or a public host name; the
# extension must be letters, so an IP address stays a candidate
NAME = re.compile(r'^[\w-]+(\.[\w-]+)*\.[A-Za-z]{2,6}$')
TICK = re.compile(r'`([^`\n]+)`')
HEADING = re.compile(r'^(#{1,6})\s+(.*)$')


def mask(v: str) -> str:
    return f'{v[:4]}...({len(v)})'


def skip_reason(v: str) -> str:
    if URL.search(v):
        return 'url'
    if EMAIL.match(v):
        return 'email'
    if PATH.search(v):
        return 'path'
    if NAME.match(v):
        return 'file-or-host-name'
    return ''


def candidates(text: str):
    """(category, row label, value, kind) for every distinct candidate, plus skip counts per reason."""
    out, skipped, seen = [], {}, set()
    category, label_of_line = '(top)', None
    for n, line in enumerate(text.splitlines(), 1):
        h = HEADING.match(line)
        if h:
            category = h.group(2).strip()
            continue
        cells = [c.strip() for c in line.strip().strip('|').split('|')] if line.lstrip().startswith('|') else []
        if cells and all(set(c) <= set('-: ') for c in cells):
            continue  # table separator row
        label_of_line = next((c for c in cells if c), '') if cells else f'line {n}'
        found = []
        for m in TICK.finditer(line):
            v = m.group(1).strip()
            if len(v) >= 10 and ' ' not in v:
                found.append((v, 'backtick'))
            elif len(v) < 10:
                skipped['short'] = skipped.get('short', 0) + 1
        for c in cells[1:] if cells else []:
            v = c.strip('`* ')
            if len(v) >= 16 and any(ch.isalpha() for ch in v) and any(ch.isdigit() for ch in v):
                found.append((v, 'table'))
        for v, kind in found:
            r = skip_reason(v)
            if r:
                skipped[r] = skipped.get(r, 0) + 1
                continue
            if v in seen:
                continue
            seen.add(v)
            # a label that is itself a candidate is masked like a value
            label = label_of_line if not (label_of_line and label_of_line.strip('`* ') == v) else mask(v)
            out.append((category, label, v, kind))
    return out, skipped


def history(repo: str) -> tuple[list[str], list[str]]:
    """Patch text of every commit on every ref, one string per commit, plus tracked files now."""
    log = subprocess.run(['git', '-C', repo, 'log', '--all', '-p', '--no-color', '--format=%x00%H'],
                         capture_output=True, check=True).stdout.decode('utf-8', 'replace')
    commits = [c for c in log.split('\x00') if c.strip()]
    files = subprocess.run(['git', '-C', repo, 'ls-files', '-z'], capture_output=True, check=True).stdout.decode('utf-8', 'replace')
    now = []
    for f in files.split('\x00'):
        p = os.path.join(repo, f)
        if f and os.path.isfile(p):
            try:
                now.append(open(p, 'rb').read().decode('utf-8', 'replace'))
            except OSError:
                pass
    return commits, now


def scan(note_text: str, repo: str) -> dict:
    cands, skipped = candidates(note_text)
    commits, now = history(repo)
    per_cat, hits = {}, []
    for category, label, v, kind in cands:
        c = per_cat.setdefault(category, {'candidates': 0, 'in_history': 0})
        c['candidates'] += 1
        n_commits = sum(1 for x in commits if v in x)
        n_files = sum(1 for x in now if v in x)
        if n_commits or n_files:
            c['in_history'] += 1
            hits.append({'category': category, 'row': label, 'kind': kind, 'value': mask(v), 'commits': n_commits, 'tracked_files_now': n_files})
    return {'repo_commits_scanned': len(commits), 'candidates': len(cands), 'found': len(hits),
            'skipped_not_scanned': skipped, 'per_category': per_cat, 'hits': hits}


def control() -> None:
    token = 'ctl' + secrets.token_hex(10)
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
        run = lambda *a: subprocess.run(['git', '-C', d, *a], capture_output=True, check=True)
        run('init', '-q')
        with open(os.path.join(d, 'f.txt'), 'w', encoding='utf-8') as f:
            f.write(f'key = {token}\n')
        run('add', 'f.txt')
        run('-c', 'user.name=control', '-c', 'user.email=control@example.invalid', 'commit', '-q', '-m', 'plant')
        os.remove(os.path.join(d, 'f.txt'))
        run('rm', '-q', '--cached', 'f.txt')
        run('-c', 'user.name=control', '-c', 'user.email=control@example.invalid', 'commit', '-q', '-m', 'remove')
        r = scan(f'## control\n| planted | `{token}` |\n| decoy | `ctl{secrets.token_hex(10)}` |\n', d)
    # added in one commit, deleted in the next: both patches carry it, the tree no longer does
    ok = r['found'] == 1 and r['candidates'] == 2 and r['hits'][0]['commits'] == 2 and r['hits'][0]['tracked_files_now'] == 0
    print(f'control: planted token found in a deleted file of a throw-away repo = {ok} (candidates {r["candidates"]}, found {r["found"]})')
    if not ok:
        sys.exit(2)


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass
    args = sys.argv[1:]
    repo = args[args.index('--repo') + 1] if '--repo' in args else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    if '--control' in args:
        control()
    note = os.environ.get('GSFPV_SENSITIVE_NOTE', '')
    if not note or not os.path.isfile(note):
        sys.exit('set GSFPV_SENSITIVE_NOTE to the path of the sensitive-data note')
    text = open(note, encoding='utf-8').read()
    r = scan(text, os.path.abspath(repo))
    print(json.dumps(r, ensure_ascii=False, indent=1))
    sys.exit(1 if r['found'] else 0)


if __name__ == '__main__':
    main()
