"""Item 6: pack barcodes (`<pack id>*ACC`). No database."""
from pathlib import Path

import pytest

from backend.domains.accessories import pack_barcode as pu

LABELS_TS = (
    Path(__file__).resolve().parents[2]
    / "frontend" / "src" / "lib" / "zpl" / "accessoryPackLabelTemplates.ts"
)


@pytest.mark.parametrize("pack_id", [1, 9, 10, 1042, 60_466_176])
def test_id_barcode_round_trip(pack_id):
    assert pu.pack_barcode(pack_id) == f"{pack_id}*ACC"
    assert pu.parse_pack_barcode(pu.pack_barcode(pack_id)) == pack_id


def test_ids_start_at_one():
    with pytest.raises(ValueError):
        pu.pack_barcode(0)


def test_scanner_noise_is_tolerated():
    assert pu.parse_pack_barcode("  1042*acc\r\n") == 1042


@pytest.mark.parametrize(
    "scan",
    ["12*F", "12*K", "R-A01", "1042", "*ACC", "0*ACC", "0012*ACC", "12A*ACC", "-5*ACC", "12*ACCX", ""],
)
def test_other_barcodes_are_not_packs(scan):
    assert pu.parse_pack_barcode(scan) is None


def test_frontend_uses_the_same_suffix():
    src = LABELS_TS.read_text(encoding="utf-8")
    assert f"PACK_BARCODE_SUFFIX = '{pu.BARCODE_SUFFIX}'" in src
