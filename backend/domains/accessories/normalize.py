"""How we decide two codes are "the same" when checking for duplicates.

Clients and suppliers write the same code in different ways on different
papers: `AB-01`, `ab 01`, `AB01`. For duplicate checks we compare a
normalized form: capitals, with spaces and the separators - . / _ removed
(decided by the user, item 9). The code is still saved exactly as typed;
only the comparison uses this.

Reused by item 10 (variant values) and item 23 (merge duplicates), so the
rule lives in one place.
"""
import re

_IGNORED = re.compile(r"[\s\-./_]+")


def normalize_code(code: str | None) -> str:
    """`" ab-01 "` → `"AB01"`. Empty when nothing is left."""
    if not code:
        return ""
    return _IGNORED.sub("", code).upper()
