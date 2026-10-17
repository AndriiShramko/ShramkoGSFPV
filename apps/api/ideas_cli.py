"""The agents' and the owner's commands on the hub, run inside the API container so they use the same
code, configuration and data as the API (tools/ideas/ideas.py runs them over SSH):

  docker exec -i gsfpv-api python /app/ideas_cli.py queue [--json]
      the work queue: accepted and in-progress ideas WITH an urgency, most urgent first (in progress
      before accepted, then the oldest), with the pilot's words and the owner's comments; then the
      accepted ones still waiting for an urgency. An agent starts here.
  ... show <id> [--json]                  one idea, everything in it (contact included: owner and agents only)
  ... list [--status S] [--kind K] [--json]
  ... status <id> <new|accepted|in_progress|done|rejected>
  ... comment <id>                        the text on stdin (an agent's note, "by": "agent")
  ... title <id>                          JSON on stdin: {"title": {"en","es","pl","ru"}, "text"?: {...}, "visible"?: bool}
                                          the roadmap's words (all four languages for the title)
  ... summary <id>                        JSON on stdin: {"en": "what was done", "pl": "..."}: the idea is done and the
                                          owner gets the DRAFT thank-you e-mail in Telegram; nothing is sent from here
  ... release <id> <sha>                  the release that shipped it
  ... tg-setup [--replace] | tg-info | tg-remove
                                          the bot's webhook (TG_OWNER_BOT_TOKEN, by default the shared lead
                                          bot): this API then reads every update of that bot and acts only on
                                          GSFPV's; --replace takes the bot over from another service's webhook
  ... mail-check                          connect to Gmail and log in, send nothing
  ... translate-check                     ask Gemini to detect and translate one test sentence (Russian -> Polish):
                                          prints ok with the model and the answer, or why not; sends no e-mail

Text comes on stdin as UTF-8 so that no shell quoting meets the pilot's or the owner's language.
Output is UTF-8 whatever the console says. Nothing here sends an e-mail: only the owner does (Telegram,
admin), and only the API process's outbox worker talks to SMTP.
"""
from __future__ import annotations

import argparse
import json
import sys

import ideas

AGENT = "agent"


def _utf8() -> None:
    for s in (sys.stdout, sys.stderr):
        if hasattr(s, "reconfigure"):
            s.reconfigure(encoding="utf-8", errors="replace")


def first_line(r: dict, n: int = 100) -> str:
    title = (r.get("public") or {}).get("title") or {}
    s = title.get("en") or ((r.get("text") or "").strip().splitlines() or [""])[0]
    return s if len(s) <= n else s[: n - 3] + "..."


def render_idea(r: dict) -> str:
    """One idea for a person or an agent reading a terminal: the pilot's words, the owner's comments,
    the e-mail thread's states, the public title, the done summary."""
    out = [f"{r['id']}  {r['kind']}  status={r['status']}  urgency={r.get('urgency') or '-'}  created={r['created']}",
           f"lang={r.get('lang') or '-'} page={r.get('page') or '-'} scene={r.get('scene') or '-'} release={r.get('release') or '-'}"
           f" contact={r.get('contact') or '-'} ({r.get('contactKind')}) diagnostics={r.get('diagnostics')}"]
    if r.get("suspect"):
        out.append("SUSPECT (honeypot or too fast)")
    out += ["", "Pilot's words:" if r["kind"] in ("idea", "bug") else "Text:", r.get("text") or "-"]
    if r.get("comments"):
        out += ["", "Owner's comments:"] + [f"  [{c['at']}] ({c.get('by')}) {c['text']}" for c in r["comments"]]
    pub = r.get("public") or {}
    if pub.get("title"):
        out += ["", "Public title: " + json.dumps(pub["title"], ensure_ascii=False) + ("" if pub.get("visible", True) else " (hidden)")]
    if (r.get("done") or {}).get("summary"):
        out += ["Done summary: " + json.dumps(r["done"]["summary"], ensure_ascii=False)]
    if r.get("releases"):
        out += ["Releases: " + ", ".join(r["releases"])]
    if r.get("thread"):
        out += ["", "E-mails:"] + [f"  {m['id']} {m['kind']} {m['state']} to={m.get('to') or '-'} {m.get('sentAt') or m.get('created')}" for m in r["thread"]]
    return "\n".join(out)


def render_queue(work: list[dict], waiting: list[dict]) -> str:
    out = [f"Work queue: {len(work)} (most urgent first)"]
    for i, r in enumerate(work, 1):
        out += ["", f"{i}. [{r['urgency']}] [{r['status']}] {r['id']} {r['kind']}: {first_line(r)}", _indent(render_idea(r))]
    if waiting:
        out += ["", f"Accepted, waiting for the owner's urgency: {len(waiting)}"]
        out += [f"  {r['id']} {r['kind']}: {first_line(r)}" for r in waiting]
    return "\n".join(out)


def _indent(s: str) -> str:
    return "\n".join("    " + x if x else "" for x in s.splitlines())


def _stdin_json() -> dict:
    try:
        v = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    except ValueError:
        sys.exit("stdin must be a JSON object")
    if not isinstance(v, dict):
        sys.exit("stdin must be a JSON object")
    return v


def main(argv: list[str] | None = None) -> int:
    _utf8()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    q = sub.add_parser("queue")
    q.add_argument("--json", action="store_true")
    s = sub.add_parser("show")
    s.add_argument("id")
    s.add_argument("--json", action="store_true")
    ls = sub.add_parser("list")
    ls.add_argument("--status", choices=ideas.STATUSES)
    ls.add_argument("--kind", choices=ideas.KINDS)
    ls.add_argument("--json", action="store_true")
    st = sub.add_parser("status")
    st.add_argument("id")
    st.add_argument("status", choices=ideas.STATUSES)
    for name in ("comment", "title", "summary"):
        sub.add_parser(name).add_argument("id")
    rl = sub.add_parser("release")
    rl.add_argument("id")
    rl.add_argument("sha")
    sub.add_parser("tg-setup").add_argument("--replace", action="store_true",
                                            help="replace a webhook another service set on this bot")
    for name in ("tg-info", "tg-remove", "mail-check", "translate-check"):
        sub.add_parser(name)
    a = p.parse_args(argv)

    import server  # noqa: PLC0415  the API's own wiring (DATA_DIR, Gmail, the owner bot) from this container's env
    from service import IdeaError  # noqa: PLC0415

    svc = server.SERVICE
    try:
        if a.cmd == "queue":
            work, waiting = svc.queue()
            print(json.dumps({"queue": work, "waiting": waiting}, ensure_ascii=False, indent=1) if a.json else render_queue(work, waiting))
        elif a.cmd == "show":
            r = svc.get(a.id)
            if r is None:
                sys.exit(f"{a.id}: not found")
            print(json.dumps(r, ensure_ascii=False, indent=1) if a.json else render_idea(r))
        elif a.cmd == "list":
            rows = [r for r in svc.all() if (a.status is None or r["status"] == a.status) and (a.kind is None or r["kind"] == a.kind)]
            if a.json:
                print(json.dumps(rows, ensure_ascii=False, indent=1))
            else:
                for r in sorted(rows, key=lambda r: r["created"], reverse=True):
                    print(f"{r['id']}  {r['kind']:7} {r['status']:11} {r.get('urgency') or '-':7} {first_line(r, 90)}")
                print(f"{len(rows)} ideas")
        elif a.cmd == "status":
            print(svc.set_status(a.id, a.status, AGENT)["status"])
        elif a.cmd == "comment":
            svc.add_comment(a.id, sys.stdin.buffer.read().decode("utf-8"), AGENT)
            print("comment saved")
        elif a.cmd == "title":
            b = _stdin_json()
            title = ideas.clean_texts(b.get("title"), ideas.TITLE_MAX)
            missing = [x for x in ideas.LOCALES if x not in title]
            if missing:
                sys.exit(f"the title needs all four languages; missing: {', '.join(missing)}")
            r = svc.set_public(a.id, AGENT, title=title, text=b.get("text"), visible=b.get("visible") if isinstance(b.get("visible"), bool) else None)
            print(json.dumps(r["public"], ensure_ascii=False))
        elif a.cmd == "summary":
            r, draft = svc.set_done_summary(a.id, _stdin_json(), AGENT)
            print(f"{r['id']}: done; " + (f"draft {draft['id']} to {draft['to']} waits for the owner's Send in Telegram" if draft else "no e-mail address: no thank-you e-mail"))
        elif a.cmd == "release":
            print(", ".join(svc.link_release(a.id, a.sha, AGENT)["releases"]))
        elif a.cmd == "tg-setup":
            print(json.dumps(server.BOT.setup_webhook(replace=a.replace)))
        elif a.cmd == "tg-info":
            print(json.dumps(server.BOT.webhook_info()))
        elif a.cmd == "tg-remove":
            print("removed" if server.BOT.remove_webhook() else "not removed (no bot token, or the webhook is not this API's)")
        elif a.cmd == "mail-check":
            print(server.MAILER.check_login())
        elif a.cmd == "translate-check":
            r = server.TRANSLATOR.check()
            print(json.dumps(r, ensure_ascii=False))
            return 0 if r["ok"] else 1
    except IdeaError as e:
        sys.exit(f"refused: {e.code}")
    except RuntimeError as e:
        sys.exit(str(e))
    return 0


if __name__ == "__main__":
    sys.exit(main())
