"""Item 6: pack UIDs (Base36), their `*ACC` barcodes, and the wms.counters table."""
import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from backend.domains.accessories import pack_uid as pu


# ── Format (no database) ─────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "number, uid",
    [
        (1, "00001"),
        (10, "0000A"),
        (35, "0000Z"),
        (36, "00010"),
        (36**5 - 1, "ZZZZZ"),  # last 5-character UID
        (36**5, "100000"),  # then it just grows
    ],
)
def test_uid_and_barcode_round_trip(number, uid):
    assert pu.format_pack_uid(number) == uid
    assert int(uid, 36) == number
    assert pu.pack_barcode(uid) == f"{uid}*ACC"
    assert pu.parse_pack_barcode(pu.pack_barcode(uid)) == uid


def test_numbers_start_at_one():
    with pytest.raises(ValueError):
        pu.format_pack_uid(0)


def test_scanner_noise_is_tolerated():
    assert pu.parse_pack_barcode("  0000a*acc\r\n") == "0000A"


@pytest.mark.parametrize(
    "scan",
    ["12*F", "12*K", "R-A01", "0000A", "*ACC", "1234*ACC", "0000$*ACC", "0000A*ACCX", "0000A*F", ""],
)
def test_other_barcodes_are_not_packs(scan):
    assert pu.parse_pack_barcode(scan) is None


# ── Counter (database) ───────────────────────────────────────────────────────

def _counter(db):
    return db.execute(
        text("SELECT last_value FROM wms.counters WHERE name = :n"), {"n": pu.COUNTER_NAME}
    ).scalar()


def test_next_pack_uid_counts_up_and_never_repeats(db):
    start = _counter(db) or 0
    uids = [pu.next_pack_uid(db) for _ in range(3)]
    assert uids == [pu.format_pack_uid(start + i) for i in (1, 2, 3)]
    assert _counter(db) == start + 3


def test_counter_cannot_go_negative(db):
    with pytest.raises(IntegrityError):
        db.execute(text("INSERT INTO wms.counters (name, last_value) VALUES ('pytest_neg', -1)"))
        db.flush()
