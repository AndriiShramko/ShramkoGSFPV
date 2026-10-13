"""Pilots' ideas and bug reports for the agent who builds them and for the owner (v0.7; replaces
tools/reports/pull.py). The ideas live on the hub (DATA_DIR/ideas.json, apps/api/ideas.py); there is no
public URL that lists them. This tool reaches them over SSH (deploy/hub.env, like deploy/neighbours.py):
reads and changes go through the API container's own CLI (apps/api/ideas_cli.py, `docker exec -i
gsfpv-api python /app/ideas_cli.py ...`), so the rules and the owner's Telegram stay in step;
`pull` copies the raw files into tools/ideas/inbox/ (gitignored: visitors' words and contacts never go
into git).

An agent starts with the queue:
  python tools/ideas/ideas.py queue                  # accepted + in progress by urgency, the pilot's words, the owner's comments
  python tools/ideas/ideas.py show N-20261013-0001   # everything about one idea
  python tools/ideas/ideas.py status R-20261002-0007 in_progress
  python tools/ideas/ideas.py comment R-20261002-0007 "found the cause: ..."
  python tools/ideas/ideas.py title R-20261002-0007 --en "Crosshair in the centre" --es "..." --pl "..." --ru "..."
                                                     # the public roadmap's title, all four languages
  python tools/ideas/ideas.py summary R-20261002-0007 --lang en "What was done, for the pilot"
                                                     # the idea is done; the owner gets the DRAFT thank-you
                                                     # e-mail in Telegram and sends it himself (never from here)
  python tools/ideas/ideas.py release R-20261002-0007 1a2b3c4
Reports, as before:
  python tools/ideas/ideas.py pull                   # reports.jsonl, every diagnostics file and ideas.json -> inbox/
  python tools/ideas/ideas.py list [--kind bug] [--status new] [--local]
  python tools/ideas/ideas.py diag R-20261002-0007   # a bug's technical details in short (pulled copy)
  python tools/ideas/ideas.py log R-20261002-0007    # inbox/<id>.gsfpvlog: the life's flight log (format /2) to replay
The owner's setup (once): tg-setup, tg-info, mail-check.

Output is UTF-8 even on a Windows console (pull.py crashed on Polish letters under cp1252).
IDEAS_INBOX overrides the inbox folder (tests).
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import subprocess
import sys
import tarfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
INBOX = Path(os.environ.get("IDEAS_INBOX") or HERE / "inbox")
REPORT_ID_RE = re.compile(r"R-[0-9]{8}-[0-9]{4,}")
ID_RE = re.compile(r"[RNF]-[A-Za-z0-9][A-Za-z0-9-]{0,47}")
SHA_RE = re.compile(r"[0-9a-f]{7,40}")
LANGS = ("en", "es", "pl", "ru")
STATUSES = ("new", "accepted", "in_progress", "done", "rejected")


def utf8_stdout() -> None:
    """Print UTF-8 whatever the console's code page (cp1252 cannot print Polish or Russian letters)."""
    for s in (sys.stdout, sys.stderr):
        if hasattr(s, "reconfigure"):
            s.reconfigure(encoding="utf-8", errors="replace")


def _hub():
    sys.path.insert(0, str(REPO / "deploy"))
    import neighbours  # noqa: PLC0415  reads deploy/hub.env; only the hub commands need it

    return neighbours.SSH, neighbours.HUB["GSFPV_BASE"]


def remote(args: list[str], stdin: bytes = b"") -> int:
    """Run apps/api/ideas_cli.py inside the API container; its UTF-8 output goes straight to ours."""
    for a in args:  # only ids, statuses, shas and flags travel on the command line; text goes on stdin
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,60}", a):
            sys.exit(f"refusing to send {a!r} over SSH")
    ssh, _ = _hub()
    r = subprocess.run(ssh + ["docker exec -i gsfpv-api python /app/ideas_cli.py " + " ".join(args)], input=stdin,
                       capture_output=True, timeout=120)
    sys.stdout.buffer.write(r.stdout)
    sys.stdout.flush()
    if r.stderr:
        sys.stderr.buffer.write(r.stderr)
    return r.returncode


def pull() -> None:
    ssh, base = _hub()
    INBOX.mkdir(parents=True, exist_ok=True)
    for name in ("reports.jsonl", "ideas.json"):
        r = subprocess.run(ssh + [f"cat {base}/data/{name} 2>/dev/null || true"], capture_output=True, timeout=180)
        if r.returncode != 0:
            sys.exit(f"ssh failed: {r.stderr.decode(errors='replace').strip()}")
        (INBOX / name).write_bytes(r.stdout)
    t = subprocess.run(ssh + [f"cd {base}/data && if [ -d reports ]; then tar cf - reports; fi"], capture_output=True, timeout=600)
    if t.returncode != 0:
        sys.exit(f"ssh failed: {t.stderr.decode(errors='replace').strip()}")
    files = 0
    if t.stdout:
        (INBOX / "reports").mkdir(exist_ok=True)
        with tarfile.open(fileobj=io.BytesIO(t.stdout)) as tar:
            for m in tar.getmembers():
                name = Path(m.name).name
                # only the diagnostics files themselves: no links, no paths out of inbox/
                if m.isfile() and Path(m.name).parent.name == "reports" and REPORT_ID_RE.fullmatch(name.removesuffix(".json")):
                    (INBOX / "reports" / name).write_bytes(tar.extractfile(m).read())
                    files += 1
    print(f"{len(local_ideas())} ideas, {files} diagnostics files -> {INBOX}")


def local_ideas() -> list[dict]:
    f = INBOX / "ideas.json"
    if not f.exists() or not f.stat().st_size:
        return []
    return json.loads(f.read_text(encoding="utf-8")).get("ideas", [])


def list_local(kind: str | None, status: str | None) -> None:
    rows = [r for r in local_ideas() if (kind is None or r.get("kind") == kind) and (status is None or r.get("status") == status) and not r.get("suspect")]
    for r in sorted(rows, key=lambda r: r.get("created") or "", reverse=True):
        first = ((r.get("text") or "").splitlines() or [""])[0][:90]
        print(f"{r['id']}  {r.get('kind', '?'):7} {r.get('status', '?'):11} {r.get('urgency') or '-':7} {r.get('scene') or '-':8}  {first}")
    print(f"{len(rows)} ideas (pulled copy)")


def show_diag(rid: str) -> None:
    """A bug's technical details in short, from the pulled copy (the flight log and the picture by size)."""
    f = INBOX / "reports" / f"{rid}.json"
    if not f.exists():
        sys.exit(f"{f} missing (run `pull`; only a bug sent with its technical details has one)")
    d = json.loads(f.read_text(encoding="utf-8")).get("diagnostics", {})
    print(f"diagnostics: {f}")
    for k, v in d.items():
        if k in ("flightLog", "screenshot"):
            print(f"  {k}: {'none' if not v else f'{len(json.dumps(v)) // 1024 + 1} KB'}")
        elif k == "errors":
            print(f"  errors ({len(v)}):")
            for e in v:
                print(f"    {e}")
        else:
            print(f"  {k}: {json.dumps(v, ensure_ascii=False)[:300]}")


def write_log(rid: str) -> None:
    f = INBOX / "reports" / f"{rid}.json"
    if not f.exists():
        sys.exit(f"{f} missing (run `pull`; only a bug sent with its technical details has one)")
    fl = json.loads(f.read_text(encoding="utf-8")).get("diagnostics", {}).get("flightLog")
    if not isinstance(fl, dict) or fl.get("format") != "gsfpv-flight/2":
        sys.exit("no flight log in these diagnostics")
    out = INBOX / f"{rid}.gsfpvlog"
    out.write_text(json.dumps(fl), encoding="utf-8")
    print(f"flight log -> {out}")


def main(argv: list[str] | None = None) -> int:
    utf8_stdout()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("pull")
    sub.add_parser("queue").add_argument("--json", action="store_true")
    s = sub.add_parser("show")
    s.add_argument("id")
    s.add_argument("--json", action="store_true")
    ls = sub.add_parser("list")
    ls.add_argument("--kind", choices=("idea", "bug", "note", "feature"))
    ls.add_argument("--status", choices=STATUSES)
    ls.add_argument("--local", action="store_true", help="read the pulled copy instead of the hub")
    st = sub.add_parser("status")
    st.add_argument("id")
    st.add_argument("status", choices=STATUSES)
    c = sub.add_parser("comment")
    c.add_argument("id")
    c.add_argument("text")
    t = sub.add_parser("title")
    t.add_argument("id")
    for lang in LANGS:
        t.add_argument(f"--{lang}", required=True)
    t.add_argument("--hide", action="store_true", help="keep it off the public roadmap")
    sm = sub.add_parser("summary")
    sm.add_argument("id")
    sm.add_argument("--lang", choices=LANGS, default="en")
    sm.add_argument("text")
    r = sub.add_parser("release")
    r.add_argument("id")
    r.add_argument("sha")
    sub.add_parser("log").add_argument("id")
    sub.add_parser("diag").add_argument("id")
    for name in ("tg-setup", "tg-info", "mail-check"):
        sub.add_parser(name)
    a = p.parse_args(argv)

    if getattr(a, "id", None) is not None and not ID_RE.fullmatch(a.id):
        sys.exit(f"{a.id}: not an idea id (R-..., N-..., F-...)")
    if a.cmd == "pull":
        pull()
        return 0
    if a.cmd == "list" and a.local:
        list_local(a.kind, a.status)
        return 0
    if a.cmd == "log":
        write_log(a.id)
        return 0
    if a.cmd == "diag":
        show_diag(a.id)
        return 0
    if a.cmd == "list":
        return remote(["list"] + (["--kind", a.kind] if a.kind else []) + (["--status", a.status] if a.status else []))
    if a.cmd in ("queue", "show"):
        return remote([a.cmd] + ([a.id] if a.cmd == "show" else []) + (["--json"] if a.json else []))
    if a.cmd == "status":
        return remote(["status", a.id, a.status])
    if a.cmd == "comment":
        return remote(["comment", a.id], a.text.encode("utf-8"))
    if a.cmd == "title":
        body = {"title": {lang: getattr(a, lang) for lang in LANGS}, **({"visible": False} if a.hide else {})}
        return remote(["title", a.id], json.dumps(body, ensure_ascii=False).encode("utf-8"))
    if a.cmd == "summary":
        return remote(["summary", a.id], json.dumps({a.lang: a.text}, ensure_ascii=False).encode("utf-8"))
    if a.cmd == "release":
        if not SHA_RE.fullmatch(a.sha):
            sys.exit(f"{a.sha}: not a commit sha")
        return remote(["release", a.id, a.sha])
    return remote([a.cmd])


if __name__ == "__main__":
    sys.exit(main())
