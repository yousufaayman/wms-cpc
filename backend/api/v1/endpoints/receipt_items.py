from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from ....database import get_db
from .... import crud, schemas

router = APIRouter()

_VALID_KINDS = {"supplier", "internal", "external"}


def _validate_kind(kind: str) -> str:
    if kind not in _VALID_KINDS:
        raise HTTPException(status_code=400, detail=f"kind must be one of {_VALID_KINDS}")
    return kind


# ── Fabric receipt items ──────────────────────────────────────────────────────

@router.get("/{kind}/{receipt_id}/fabric-items", response_model=List[schemas.FabricReceiptItem])
def list_fabric_items(kind: str, receipt_id: int, skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    _validate_kind(kind)
    return crud.receipt_items.get_fabric_items_for_receipt(db, kind, receipt_id, skip, limit)


@router.post("/{kind}/{receipt_id}/fabric-items", response_model=schemas.FabricReceiptItem, status_code=status.HTTP_201_CREATED)
def add_fabric_item(kind: str, receipt_id: int, item: schemas.FabricReceiptItemCreate, db: Session = Depends(get_db)):
    _validate_kind(kind)
    return crud.receipt_items.create_fabric_receipt_item(db, kind, receipt_id, item)


@router.delete("/fabric-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_fabric_item(item_id: int, db: Session = Depends(get_db)):
    if not crud.receipt_items.delete_fabric_receipt_item(db, item_id):
        raise HTTPException(status_code=404, detail="Fabric receipt item not found")


# ── Box receipt items ─────────────────────────────────────────────────────────

@router.get("/{kind}/{receipt_id}/box-items", response_model=List[schemas.BoxReceiptItem])
def list_box_items(kind: str, receipt_id: int, skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    _validate_kind(kind)
    return crud.receipt_items.get_box_items_for_receipt(db, kind, receipt_id, skip, limit)


@router.post("/{kind}/{receipt_id}/box-items", response_model=schemas.BoxReceiptItem, status_code=status.HTTP_201_CREATED)
def add_box_item(kind: str, receipt_id: int, item: schemas.BoxReceiptItemCreate, db: Session = Depends(get_db)):
    _validate_kind(kind)
    return crud.receipt_items.create_box_receipt_item(db, kind, receipt_id, item)


@router.delete("/box-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_box_item(item_id: int, db: Session = Depends(get_db)):
    if not crud.receipt_items.delete_box_receipt_item(db, item_id):
        raise HTTPException(status_code=404, detail="Box receipt item not found")


# ── Accessory receipt items ───────────────────────────────────────────────────

@router.get("/{kind}/{receipt_id}/accessory-items", response_model=List[schemas.AccessoryReceiptItem])
def list_accessory_items(kind: str, receipt_id: int, skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    _validate_kind(kind)
    return crud.receipt_items.get_accessory_items_for_receipt(db, kind, receipt_id, skip, limit)


@router.post("/{kind}/{receipt_id}/accessory-items", response_model=schemas.AccessoryReceiptItem, status_code=status.HTTP_201_CREATED)
def add_accessory_item(kind: str, receipt_id: int, item: schemas.AccessoryReceiptItemCreate, db: Session = Depends(get_db)):
    _validate_kind(kind)
    return crud.receipt_items.create_accessory_receipt_item(db, kind, receipt_id, item)


@router.delete("/accessory-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_accessory_item(item_id: int, db: Session = Depends(get_db)):
    if not crud.receipt_items.delete_accessory_receipt_item(db, item_id):
        raise HTTPException(status_code=404, detail="Accessory receipt item not found")
