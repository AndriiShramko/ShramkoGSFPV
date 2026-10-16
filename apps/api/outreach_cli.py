"""The Outreach snapshot on the hub, for the vault's `fbgroups.py push` and for whoever looks at it; run
inside the API container so the code, the ceilings and the data directory are the API's own
(tools/ideas/ideas.py does the same for ideas):

  docker exec -i gsfpv-api python /app/outreach_cli.py push -       the snapshot (JSON, UTF-8) on stdin; checked,
                                                                    then the one file outreach.json is replaced whole.
                                                                    A refused snapshot leaves the previous one untouched
                                                                    (exit 1, the reasons on stderr)
  ... show [--json]                                                 what is stored (a summary, or the whole view)
  ... clear                                                         delete the stored snapshot (the tab shows its empty
                                                                    state until the next push)

The admin never writes: this command is the only way in. The vault holds the truth, so after a lost
server, a `push` restores the tab. Output is UTF-8 whatever the console says.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import outreach


def _utf8() -> None:
    for s in (sys.stdout, sys.stderr):
        if hasattr(s, "reconfigure"):
            s.reconfigure(encoding="utf-8", errors="replace")


def summary(view: dict) -> str:
    t = view["totals"]
    out = [f"campaign {view['campaign']}: snapshot generated {view['generated']}, received {view['received']}"
           f" ({view['age_h']} h ago{', STALE' if view['stale'] else ''})",
           f"{t['groups']} groups ({t['posted']} posted to, {t['published']} published, {t['removed']} with a removal, {t['banned']} banned), "
           f"{t['posts']} posts ({t['posts_published']} published, {t['posts_removed']} removed, {t['posts_waiting']} waiting)",
           f"reactions {t['reactions']}, comments {t['comments']}, shares {t['shares']}, views {t['views']}"]
    for r in view["ranking"][:5]:
        out.append(f"  {r['score']:5.1f}{' *' if r['worth'] else '  '} {r['name']} ({r['id']})")
    d = view["due"]
    out.append(f"due now: {len(d['checks'])} checks, {len(d['unresolved'])} unresolved, {len(d['ready'])} wave-1 groups without a post")
    return "\n".join(out)


def main(argv: list[str] | None = None, data_dir: Path | None = None, stdin=None) -> int:
    _utf8()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("push").add_argument("source", help="'-' for stdin (a file path also works)")
    s = sub.add_parser("show")
    s.add_argument("--json", action="store_true")
    sub.add_parser("clear")
    a = p.parse_args(argv)
    store = outreach.OutreachStore(lambda: data_dir or Path(os.environ.get("DATA_DIR", "/data")))
    try:
        if a.cmd == "push":
            if a.source == "-":
                raw = (stdin or sys.stdin.buffer).read(outreach.MAX_BYTES + 1)
            else:
                raw = Path(a.source).read_bytes()[: outreach.MAX_BYTES + 1]
            r = store.put(raw)
            print(f"accepted: {r['groups']} groups, {r['posts']} posts, {r['bytes']} bytes (ceiling {outreach.MAX_BYTES}), campaign {r['campaign']}")
            if r["replaced_campaign"]:
                print(f"note: this replaced the stored snapshot of campaign {r['replaced_campaign']} (the tab shows one campaign)")
        elif a.cmd == "show":
            doc = store.read()
            if not doc:
                print("nothing stored: the Outreach tab shows its empty state")
                return 0
            view = outreach.build_view(doc, time.time())
            print(json.dumps(view, ensure_ascii=False, indent=1) if a.json else summary(view))
        elif a.cmd == "clear":
            print("cleared" if store.clear() else "nothing to clear")
    except outreach.BadSnapshot as e:
        print("refused, the previous snapshot is untouched:", file=sys.stderr)
        for reason in e.reasons:
            print(f"  - {reason}", file=sys.stderr)
        return 1
    except outreach.StoreUnreadable as e:
        print(f"the stored snapshot cannot be read ({e}); push a new one or run clear", file=sys.stderr)
        return 1
    except OSError as e:
        print(f"disk error: {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
