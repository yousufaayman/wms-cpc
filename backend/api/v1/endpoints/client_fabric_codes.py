from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from backend import models
from backend.core.deps import get_db, require_permission
from backend.core.authz import PERM_INGEST_FABRIC
from backend.crud import client_fabric_codes as crud_cfc
from backend.schemas import ClientFabricCode, ClientFabricCodeCreate, FabricCodeLookupResult
from pydantic import BaseModel

router = APIRouter()
# Client fabric codes are created while scanning/ingesting fabric rolls.
_REQUIRE_INGEST = Depends(require_permission(PERM_INGEST_FABRIC))


class GetOrCreateRequest(BaseModel):
    client_id: int
    material_id: int
    color_id: int
    fabric_code: Optional[str] = None


@router.get("/", response_model=List[ClientFabricCode])
def get_client_fabric_codes(
    skip: int = 0,
    limit: int = 200,
    client_id: Optional[int] = Query(None),
    material_id: Optional[int] = Query(None),
    color_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """List client fabric codes, optionally filtered by client/material/color."""
    return crud_cfc.get_client_fabric_codes(
        db, skip=skip, limit=limit,
        client_id=client_id, material_id=material_id, color_id=color_id,
    )


@router.get("/lookup", response_model=List[FabricCodeLookupResult])
def lookup_client_fabric_codes(
    q: str = Query(..., min_length=1, description="Fabric code substring to search for"),
    limit: int = Query(20, le=50),
    db: Session = Depends(get_db),
):
    """Fabric codes matching the query, with client/material/color names and
    current in-stock totals — powers the dashboard fabric code lookup widget."""
    return crud_cfc.search_client_fabric_codes(db, query=q, limit=limit)


@router.get("/{cfc_id}", response_model=ClientFabricCode)
def get_client_fabric_code(cfc_id: int, db: Session = Depends(get_db)):
    obj = crud_cfc.get_client_fabric_code(db, cfc_id)
    if not obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client fabric code not found")
    return obj


@router.post("/", response_model=ClientFabricCode, status_code=status.HTTP_201_CREATED)
def create_client_fabric_code(cfc: ClientFabricCodeCreate, db: Session = Depends(get_db), current_user: models.User = _REQUIRE_INGEST):
    """Create a new client fabric code."""
    return crud_cfc.create_client_fabric_code(db, cfc)


@router.post("/get-or-create", response_model=ClientFabricCode)
def get_or_create_client_fabric_code(body: GetOrCreateRequest, db: Session = Depends(get_db), current_user: models.User = _REQUIRE_INGEST):
    """Return existing client fabric code for the combination, or create one if absent."""
    return crud_cfc.get_or_create_client_fabric_code(
        db,
        client_id=body.client_id,
        material_id=body.material_id,
        color_id=body.color_id,
        fabric_code=body.fabric_code,
    )
