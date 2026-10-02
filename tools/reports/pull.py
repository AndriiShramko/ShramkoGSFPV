"""Bug reports and ideas sent from the simulator and the landing (POST /api/report), for the owner and
the agent who fixes them. There is no public URL that lists reports: this script reads them from the
hub over SSH (deploy/hub.env, like deploy/neighbours.py) into tools/reports/inbox/ (gitignored: the
reports hold visitors' words and contacts, never commit them).

  python tools/reports/pull.py pull                 # copy reports.jsonl and every diagnostics file from the hub
  python tools/reports/pull.py list [--kind bug] [--all]
                                                    # open reports, newest first (--all: closed ones too)
  python tools/reports/pull.py show R-20261002-0007 # the report, its diagnostics in short, the files
  python tools/reports/pull.py show R-20261002-0007 --log
                                                    # also writes inbox/<id>.gsfpvlog (the life's flight log,
                                                    # format /2) to replay in the simulator
  python tools/reports/pull.py close R-20261002-0007 --note "fixed in 1a2b3c4"
  python tools/reports/pull.py reopen R-20261002-0007

Open or closed is kept in inbox/status.json on this machine (one line per change, the newest wins).
"""
from __future__ import annotations

import argparse
import io
import json
import re
import subprocess
import sys
import tarfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
INBOX = HERE / "inbox"
REPORTS = INBOX / "reports.jsonl"
DIAG = INBOX / "reports"
STATUS = INBOX / "status.json"
ID_RE = re.compile(r"R-[0-9]{8}-[0-9]{4,}")


def _hub():
    sys.path.insert(0, str(HERE.parents[1] / "deploy"))
    import neighbours  # noqa: PLC0415  reads deploy/hub.env; only `pull` needs the hub

    return neighbours.SSH, neighbours.HUB["GSFPV_BASE"]


def pull() -> None:
    ssh, base = _hub()
    INBOX.mkdir(exist_ok=True)
    r = subprocess.run(ssh + [f"cat {base}/data/reports.jsonl 2>/dev/null || true"], capture_output=True, timeout=180)
    if r.returncode != 0:
        sys.exit(f"ssh failed: {r.stderr.decode(errors='replace').strip()}")
    REPORTS.write_bytes(r.stdout)
    t = subprocess.run(ssh + [f"cd {base}/data && if [ -d reports ]; then tar cf - reports; fi"], capture_output=True, timeout=600)
    if t.returncode != 0:
        sys.exit(f"ssh failed: {t.stderr.decode(errors='replace').strip()}")
    files = 0
    if t.stdout:
        DIAG.mkdir(exist_ok=True)
        with tarfile.open(fileobj=io.BytesIO(t.stdout)) as tar:
            for m in tar.getmembers():
                name = Path(m.name).name
                # only the diagnostics files themselves: no links, no paths out of inbox/
                if m.isfile() and Path(m.name).parent.name == "reports" and ID_RE.fullmatch(name.removesuffix(".json")):
                    (DIAG / name).write_bytes(tar.extractfile(m).read())
                    files += 1
    print(f"{len(records())} reports, {files} diagnostics files -> {INBOX}")


def records() -> list[dict]:
    if not REPORTS.exists():
        return []
    out = []
    for line in REPORTS.read_text(encoding="utf-8").splitlines():
        try:
            out.append(json.loads(line))
        except ValueError:
            continue
    return out


def statuses() -> dict[str, dict]:
    st: dict[str, dict] = {}
    if STATUS.exists():
        for line in STATUS.read_text(encoding="utf-8").splitlines():
            try:
                s = json.loads(line)
                st[s["id"]] = s
            except (ValueError, KeyError):
                continue
    return st


def set_status(rid: str, status: str, note: str) -> None:
    if not any(r.get("id") == rid for r in records()):
        sys.exit(f"{rid}: not in {REPORTS} (run `pull` first)")
    INBOX.mkdir(exist_ok=True)
    with STATUS.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"id": rid, "status": status, "note": note, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, ensure_ascii=False) + "\n")
    print(f"{rid}: {status}")


def list_reports(kind: str | None, show_all: bool) -> None:
    st = statuses()
    rows = [r for r in records() if (kind is None or r.get("kind") == kind) and not r.get("suspect")]
    rows = [r for r in rows if show_all or st.get(r["id"], {}).get("status", "open") == "open"]
    for r in sorted(rows, key=lambda r: r["id"], reverse=True):
        first = r.get("message", "").splitlines()[0][:90] if r.get("message") else ""
        diag = "diag" if r.get("diagnostics") is True else "    "
        state = st.get(r["id"], {}).get("status", "open")
        print(f"{r['id']}  {r.get('kind', '?'):4} {state:6} {diag} {r.get('page') or '-':4} {r.get('scene') or '-':8} {r.get('release') or '-':8}  {first}")
    print(f"{len(rows)} {'' if show_all else 'open '}reports" + (f" ({kind})" if kind else ""))


def show(rid: str, log: bool) -> None:
    rec = next((r for r in records() if r.get("id") == rid), None)
    if rec is None:
        sys.exit(f"{rid}: not in {REPORTS} (run `pull` first)")
    print(json.dumps(rec, ensure_ascii=False, indent=1))
    st = statuses().get(rid)
    if st:
        print(f"status: {st['status']} ({st['at']}) {st.get('note', '')}")
    f = DIAG / f"{rid}.json"
    if not f.exists():
        print("diagnostics: none" if rec.get("diagnostics") is not True else f"diagnostics: {f} missing (run `pull`)")
        return
    d = json.loads(f.read_text(encoding="utf-8")).get("diagnostics", {})
    print(f"diagnostics: {f}")
    for k, v in d.items():
        if k in ("flightLog", "screenshot"):
            size = len(json.dumps(v)) if v else 0
            print(f"  {k}: {'none' if not v else f'{size // 1024 + 1} KB'}")
        elif k == "errors":
            print(f"  errors ({len(v)}):")
            for e in v:
                print(f"    {e}")
        else:
            print(f"  {k}: {json.dumps(v, ensure_ascii=False)[:300]}")
    if log:
        fl = d.get("flightLog")
        if not isinstance(fl, dict) or fl.get("format") != "gsfpv-flight/2":
            sys.exit("no flight log in these diagnostics")
        out = INBOX / f"{rid}.gsfpvlog"
        out.write_text(json.dumps(fl), encoding="utf-8")
        print(f"flight log -> {out}")
    if d.get("screenshot"):
        print("  screenshot: data URL inside the file (a small JPEG of the view)")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("pull")
    pl = sub.add_parser("list")
    pl.add_argument("--kind", choices=("bug", "idea"))
    pl.add_argument("--all", action="store_true")
    ps = sub.add_parser("show")
    ps.add_argument("id")
    ps.add_argument("--log", action="store_true")
    for name in ("close", "reopen"):
        pc = sub.add_parser(name)
        pc.add_argument("id")
        pc.add_argument("--note", default="")
    a = p.parse_args()
    if a.cmd == "pull":
        pull()
    elif a.cmd == "list":
        list_reports(a.kind, a.all)
    elif a.cmd == "show":
        show(a.id, a.log)
    else:
        set_status(a.id, "closed" if a.cmd == "close" else "open", a.note)


if __name__ == "__main__":
    main()
