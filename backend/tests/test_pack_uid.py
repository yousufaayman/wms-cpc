"""Item 6: pack UIDs (pack id in Base36) and their `*ACC` barcodes. No database."""
import re
from pathlib import Path

import pytest

from backend.domains.accessories import pack_uid as pu

LABELS_TS = (
    Path(__file__).resolve().parents[2]
    / "frontend" / "src" / "lib" / "zpl" / "accessoryPackLabelTemplates.ts"
)


@pytest.mark.parametrize(
    "pack_id, uid",
    [
        (1, "00001"),
        (10, "0000A"),
        (35, "0000Z"),
        (36, "00010"),
        (1042, "000SY"),
        (36**5 - 1, "ZZZZZ"),  # last 5-character UID
        (36**5, "100000"),  # then it just grows
    ],
)
def test_id_uid_barcode_round_trip(pack_id, uid):
    assert pu.pack_uid(pack_id) == uid
    assert pu.pack_barcode(pack_id) == f"{uid}*ACC"
    assert pu.parse_pack_barcode(pu.pack_barcode(pack_id)) == pack_id


def test_ids_start_at_one():
    with pytest.raises(ValueError):
        pu.pack_uid(0)


def test_scanner_noise_is_tolerated():
    assert pu.parse_pack_barcode("  0000a*acc\r\n") == 10


@pytest.mark.parametrize(
    "scan",
    ["12*F", "12*K", "R-A01", "0000A", "*ACC", "1234*ACC", "0000$*ACC", "0000A*ACCX", "0000A*F", ""],
)
def test_other_barcodes_are_not_packs(scan):
    assert pu.parse_pack_barcode(scan) is None


def test_frontend_uses_the_same_rule():
    """The label builder computes the UID itself; it must match the backend."""
    src = LABELS_TS.read_text(encoding="utf-8")
    assert f"PACK_BARCODE_SUFFIX = '{pu.BARCODE_SUFFIX}'" in src
    assert re.search(rf"toString\(36\)\.toUpperCase\(\)\.padStart\({pu.MIN_LENGTH}, '0'\)", src)
