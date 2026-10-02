"""Make the ADMIN_PASSWORD_HASH line for the server's config.env (deploy/README.md, "Admin").

    python tools/admin/hash_password.py              asks twice, without echo
    printf '%s' "$PW" | python tools/admin/hash_password.py --stdin   one line from a pipe (scripts, tests)

Prints only the line ADMIN_PASSWORD_HASH=scrypt:n:r:p:salt:hash (a fresh random salt each run, so two
runs never print the same line). The password itself is never printed, stored or logged; the line is
a hash, still keep it out of git (config.env is gitignored).
"""
from __future__ import annotations

import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps" / "api"))
from admin import make_hash  # noqa: E402  (the one implementation the server checks against)

SHORT = 12


def main() -> int:
    if "--stdin" in sys.argv[1:]:
        pw = sys.stdin.readline().rstrip("\r\n")
    else:
        pw = getpass.getpass("Admin password: ")
        if getpass.getpass("Again: ") != pw:
            print("The two entries differ; nothing printed.", file=sys.stderr)
            return 1
    if not pw:
        print("Empty password; nothing printed.", file=sys.stderr)
        return 1
    if len(pw) < SHORT:
        # the owner's choice; the login's lockouts (5 per address per 15 min, 30 an hour in all) protect it
        print(f"Note: shorter than {SHORT} characters.", file=sys.stderr)
    print(f"ADMIN_PASSWORD_HASH={make_hash(pw)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
