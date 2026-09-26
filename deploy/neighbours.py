"""Neighbour snapshots for deploys on the shared hub, taken from OUTSIDE (this machine) plus the
server-side files from snapshot-server.sh, and a diff between two snapshots.

  python deploy/neighbours.py snap <dir>           # server snapshot (over SSH) + external HTTP codes/hashes
  python deploy/neighbours.py diff <before> <after> [--allow gsfpv-web,gsfpv-api] [--stable <b1>,<b2>,...] [--offline]

The HTTP part requests every vhost found in the live `docker ps` (not a list from notes) with a
cache-busting query and records status + sha256 of the body. Bodies of dynamic pages change on
every request, so a body hash is compared only where it was identical in two BEFORE snapshots.
Allowed differences: our own containers/vhost/networks (gsfpv*) added. The diff also reads the
nginx-proxy log between the two snapshot times (docker logs --since/--until over SSH, read-only)
and counts [emerg]/[crit]; --offline skips that (replaying old snapshots) and says so in the output.
Anything else in the diff = STOP and roll back.
"""
import hashlib
import json
import os
import random
import re
import subprocess
import sys
import time
import urllib.request
import ssl

def _hub_env() -> dict:
    # hub address, port, key and paths: deploy/hub.env (gitignored), then the environment
    env = {}
    p = os.path.join(os.path.dirname(__file__), 'hub.env')
    if os.path.exists(p):
        for line in open(p, encoding='utf-8'):
            if '=' in line and not line.lstrip().startswith('#'):
                k, v = line.strip().split('=', 1)
                env[k] = v
    env.update({k: v for k, v in os.environ.items() if k.startswith('GSFPV_')})
    return env


HUB = _hub_env()
HOST = HUB['GSFPV_HOST']
KEY = os.path.expanduser(HUB.get('GSFPV_KEY', '~/.ssh/id_ed25519'))
if KEY.startswith('/c/'):
    KEY = 'C:/' + KEY[3:]
SSH = ['ssh', '-p', HUB.get('GSFPV_PORT', '22'), '-i', KEY, '-o', 'ConnectTimeout=20', HOST]


def ssh(cmd: str) -> str:
    return subprocess.run(SSH + [cmd], capture_output=True, text=True, timeout=180).stdout


def fetch(url: str) -> tuple[int, str]:
    ctx = ssl.create_default_context()
    req = urllib.request.Request(url + ('&' if '?' in url else '?') + f'cb={random.randrange(1 << 30)}', headers={'User-Agent': 'gsfpv-neighbour-check/1'})
    try:
        with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
            return r.status, hashlib.sha256(r.read()).hexdigest()
    except urllib.error.HTTPError as e:
        return e.code, hashlib.sha256(e.read() or b'').hexdigest()
    except Exception as e:  # noqa: BLE001
        return -1, type(e).__name__


def snap(out: str) -> None:
    os.makedirs(out, exist_ok=True)
    name = os.path.basename(os.path.abspath(out))
    remote = f"{HUB['GSFPV_BACKUPS']}/{name}"
    # the script may have CRLF endings in a Windows checkout; bash on the server needs LF
    script = open(os.path.join(os.path.dirname(__file__), 'snapshot-server.sh'), encoding='utf-8').read().replace(chr(13), '')
    # bytes, not text: text mode on Windows would turn every \n into \r\n on the way to bash
    res = subprocess.run(SSH + [f'bash -s {remote}'], input=script.encode('utf-8'), capture_output=True, timeout=300)
    stdout = res.stdout.decode('utf-8', 'replace')
    if 'OK' not in stdout:
        raise SystemExit(f'server snapshot failed: {stdout} {res.stderr.decode("utf-8", "replace")}')
    files = {}
    for f in ['containers.txt', 'started.txt', 'vhosts.txt', 'listening.txt', 'df.txt', 'networks.txt', 'taken_at.txt', 'SHA256SUMS']:
        files[f] = ssh(f'cat {remote}/{f}')
    conf = ssh(f'cat {remote}/nginx-proxy-default.conf')
    files['nginx-proxy-default.conf.sha256'] = hashlib.sha256(conf.encode()).hexdigest()
    hosts = sorted({line.split('|', 1)[1].strip() for line in files['vhosts.txt'].splitlines() if '|' in line})
    http = {}
    for h in hosts:
        code, digest = fetch(f'https://{h}/')
        http[h] = {'code': code, 'sha256': digest}
    data = {'taken_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'remote_dir': remote, 'server': files, 'http': http}
    with open(os.path.join(out, 'snapshot.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=1)
    print(json.dumps({'dir': out, 'containers': len(files['containers.txt'].splitlines()), 'vhosts': len(hosts)}))


def load(d: str) -> dict:
    return json.load(open(os.path.join(d, 'snapshot.json'), encoding='utf-8'))


def rows(text: str) -> dict:
    out = {}
    for line in text.splitlines():
        if '|' in line:
            k, v = line.split('|', 1)
            out.setdefault(k, []).append(v)
    return out


def diff(a_dir: str, b_dir: str, allow: set, stable_dirs: list[str], offline: bool = False) -> int:
    a, b = load(a_dir), load(b_dir)
    # a body is "static" only if it was identical in EVERY before snapshot: two snapshots a minute
    # apart can sit inside one ISR window (Next.js s-maxage=60) and make a live page look static
    stables = [load(d) for d in stable_dirs]
    problems = []
    ca, cb = rows(a['server']['containers.txt']), rows(b['server']['containers.txt'])
    for k in sorted(set(ca) | set(cb)):
        if k in allow:
            continue
        if k not in cb:
            problems.append(f'container gone: {k}')
        elif k not in ca:
            problems.append(f'container added: {k}')
        elif [s.split('|')[0] for s in ca[k]] != [s.split('|')[0] for s in cb[k]]:
            problems.append(f'image changed: {k}')
    sa, sb = rows(a['server']['started.txt']), rows(b['server']['started.txt'])
    for k in sorted(set(sa) & set(sb)):
        if k in allow:
            continue
        pa, pb = sa[k][0].split('|'), sb[k][0].split('|')
        if pa[0] != pb[0]:
            problems.append(f'restarted: {k} ({pa[0]} -> {pb[0]})')
        if pa[1] != pb[1]:
            problems.append(f'restart count: {k} ({pa[1]} -> {pb[1]})')
    la = set(a['server']['listening.txt'].split()); lb = set(b['server']['listening.txt'].split())
    for p in sorted(lb - la):
        problems.append(f'new listening socket: {p}')
    for h, v in a['http'].items():
        w = b['http'].get(h)
        if w is None:
            problems.append(f'vhost missing after: {h}')
            continue
        if v['code'] != w['code']:
            problems.append(f'http code changed: {h} {v["code"]} -> {w["code"]}')
        if stables and all(st['http'].get(h, {}).get('sha256') == v['sha256'] for st in stables) and v['sha256'] != w['sha256']:
            problems.append(f'body changed on a static page: {h}')
    added_hosts = sorted(set(b['http']) - set(a['http']))
    # networks: only our own (gsfpv*) may appear; none may vanish or change driver
    na, nb = rows(a['server'].get('networks.txt', '')), rows(b['server'].get('networks.txt', ''))
    added_networks = sorted(set(nb) - set(na))
    for k in sorted(set(na) | set(nb)):
        if k not in nb:
            problems.append(f'network gone: {k}')
        elif k not in na:
            if not k.startswith('gsfpv'):
                problems.append(f'network added: {k}')
        elif na[k] != nb[k]:
            problems.append(f'network driver changed: {k}')
    if not na:
        problems.append('networks.txt missing in the BEFORE snapshot')
    log = {'checked': False, 'reason': '--offline'} if offline else proxy_log(window(a), window(b))
    if not log['checked'] and not offline:
        problems.append(f'nginx-proxy log not checked: {log["reason"]}')
    elif log['checked'] and log['emerg_crit']:
        problems.append(f'nginx-proxy log: {log["emerg_crit"]} [emerg]/[crit] lines in the deploy window')
    out = {'before': a_dir, 'after': b_dir, 'problems': problems, 'added_vhosts': added_hosts,
           'added_networks': added_networks, 'nginx_proxy_log': log, 'complete': log['checked'], 'equal': not problems}
    print(json.dumps(out, indent=1))
    return 0 if not problems else 1


STAMP = re.compile(r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$')


def window(s: dict) -> str:
    # the server clock (taken_at.txt) bounds docker logs; the local clock is only a fallback
    t = s['server'].get('taken_at.txt', '').strip() or s.get('taken_at', '')
    return t if STAMP.match(t) else ''


def proxy_log(since: str, until: str) -> dict:
    """Count nginx [emerg]/[crit] lines that nginx-proxy logged between the two snapshots.

    Read-only (docker logs over SSH). The spec asks for `emerg|crit`; nginx writes its levels as
    [emerg]/[crit], and only those count as problems: a bare substring also hits access-log URLs
    of neighbour sites, so that looser count is reported for information only. Sample lines are
    returned with IPv4 addresses masked, since the proxy logs visitors of every site on the hub."""
    if not since or not until or since > until:
        return {'checked': False, 'reason': f'bad snapshot times {since!r}..{until!r}'}
    cmd = (f'out=$(docker logs --since {since} --until {until} nginx-proxy 2>&1); rc=$?; '
           'echo "rc=$rc lines=$(printf "%s\\n" "$out" | grep -c .)"; '
           'printf "%s\\n" "$out" | grep -iE "emerg|crit" | head -n 200')
    res = ssh(cmd).splitlines()
    head = res[0] if res else ''
    m = re.match(r'^rc=(\d+) lines=(\d+)$', head)
    if not m or m.group(1) != '0':
        return {'checked': False, 'reason': f'docker logs failed: {head or "no output"}'}
    loose = res[1:]
    strict = [x for x in loose if re.search(r'\[(emerg|crit)\]', x)]
    mask = lambda x: re.sub(r'\b\d{1,3}(\.\d{1,3}){3}\b', 'x.x.x.x', x)[:300]
    return {'checked': True, 'since': since, 'until': until, 'lines_in_window': int(m.group(2)),
            'emerg_crit': len(strict), 'emerg_crit_substring': len(loose), 'samples': [mask(x) for x in strict[:3]]}


if __name__ == '__main__':
    if sys.argv[1] == 'snap':
        snap(sys.argv[2])
    elif sys.argv[1] == 'diff':
        allow = set()
        stable: list[str] = []
        args = sys.argv[4:]
        for i, x in enumerate(args):
            if x == '--allow':
                allow = set(args[i + 1].split(','))
            if x == '--stable':
                stable = args[i + 1].split(',')
        sys.exit(diff(sys.argv[2], sys.argv[3], allow, stable, '--offline' in args))
