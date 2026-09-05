from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from backend import schemas, models
from backend.crud import boxes
from backend.core.deps import get_db, require_permission
from backend.core.authz import PERM_CREATE_RECEIPTS

router = APIRouter()
# Boxes back the box-type receipt item flow, so they're gated the same way.
_REQUIRE_CREATE_RECEIPTS = Depends(require_permission(PERM_CREATE_RECEIPTS))

@router.post("/", response_model=schemas.Box, status_code=status.HTTP_201_CREATED)
def create_box(
    *,
    db: Session = Depends(get_db),
    box_in: schemas.BoxCreate,
    current_user: models.User = _REQUIRE_CREATE_RECEIPTS,
) -> schemas.Box:
    """
    Create a new box.
    """
    # Check if box with this barcode already exists
    existing_box = boxes.get_box_by_barcode(db, barcode=box_in.barcode)
    if existing_box:
        raise HTTPException(
            status_code=400,
            detail="A box with this barcode already exists.",
        )
    
    box = boxes.create_box(db=db, obj_in=box_in)
    return box

@router.get("/aggregated", response_model=List[schemas.BoxAggregation])
def read_boxes_with_aggregations(
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 100,
    warehouse_id: Optional[int] = Query(None, description="Filter by warehouse ID"),
    search_term: Optional[str] = Query(None, description="Search by barcode"),
    rack_code: Optional[str] = Query(None, description="Filter by rack code"),
    client_name: Optional[str] = Query(None, description="Filter by client name"),
    model_name: Optional[str] = Query(None, description="Filter by model name"),
    color_name: Optional[str] = Query(None, description="Filter by color name"),
    size_value: Optional[str] = Query(None, description="Filter by size value"),
    job_order_item_id: Optional[int] = Query(None, description="Filter by job order item ID"),
    received: Optional[bool] = Query(None, description="Filter by received status"),
) -> List[schemas.BoxAggregation]:
    """
    Retrieve boxes with pre-calculated aggregations for inventory management.
    This endpoint provides database-level aggregations for better performance.
    """
    if warehouse_id is not None:
        return boxes.get_boxes_with_aggregations_by_warehouse(
            db, warehouse_id=warehouse_id, skip=skip, limit=limit, received=received
        )
    else:
        return boxes.search_boxes_with_aggregations(
            db,
            search_term=search_term,
            rack_code=rack_code,
            client_name=client_name,
            model_name=model_name,
            color_name=color_name,
            size_value=size_value,
            job_order_item_id=job_order_item_id,
            received=received,
            skip=skip,
            limit=limit
        )

@router.get("/", response_model=List[schemas.BoxWithDetails])
def read_boxes(
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 100,
    rack_id: Optional[int] = Query(None, description="Filter by rack ID"),
    shipment_no: Optional[str] = Query(None, description="Filter by shipment number"),
    received: Optional[bool] = Query(None, description="Filter by received status"),
) -> List[schemas.BoxWithDetails]:
    """
    Retrieve boxes with optional filtering.
    """
    if rack_id is not None:
        box_list = boxes.get_boxes_by_rack(db, rack_id=rack_id, skip=skip, limit=limit)
    else:
        box_list = boxes.get_boxes(db, skip=skip, limit=limit, received=received)
    
    return box_list

@router.get("/{box_id}", response_model=schemas.BoxWithDetails)
def read_box(
    *,
    db: Session = Depends(get_db),
    box_id: int,
) -> schemas.BoxWithDetails:
    """
    Get a specific box by id.
    """
    box = boxes.get_box(db=db, id=box_id)
    if not box:
        raise HTTPException(
            status_code=404,
            detail="Box not found",
        )
    return box

@router.get("/barcode/{barcode}", response_model=schemas.BoxWithDetails)
def read_box_by_barcode(
    *,
    db: Session = Depends(get_db),
    barcode: str,
) -> schemas.BoxWithDetails:
    """
    Get a specific box by barcode.
    """
    box = boxes.get_box_by_barcode(db, barcode=barcode)
    if not box:
        raise HTTPException(
            status_code=404,
            detail="Box not found",
        )
    return box

@router.put("/{box_id}", response_model=schemas.Box)
def update_box(
    *,
    db: Session = Depends(get_db),
    box_id: int,
    box_in: schemas.BoxUpdate,
    current_user: models.User = _REQUIRE_CREATE_RECEIPTS,
) -> schemas.Box:
    """
    Update a box.
    """
    box = boxes.get_box(db=db, id=box_id)
    if not box:
        raise HTTPException(
            status_code=404,
            detail="Box not found",
        )
    
    # Check if new barcode already exists (if barcode is being updated)
    if box_in.barcode and box_in.barcode != box.barcode:
        existing_box = boxes.get_box_by_barcode(db, barcode=box_in.barcode)
        if existing_box:
            raise HTTPException(
                status_code=400,
                detail="A box with this barcode already exists.",
            )
    
    box = boxes.update_box(db=db, db_obj=box, obj_in=box_in)
    return box

@router.delete("/{box_id}", response_model=schemas.Box)
def delete_box(
    *,
    db: Session = Depends(get_db),
    box_id: int,
    current_user: models.User = _REQUIRE_CREATE_RECEIPTS,
) -> schemas.Box:
    """
    Delete a box.
    """
    box = boxes.get_box(db=db, id=box_id)
    if not box:
        raise HTTPException(
            status_code=404,
            detail="Box not found",
        )
    
    box = boxes.delete_box(db=db, id=box_id)
    return box


