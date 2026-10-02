from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from backend.core.authz import PERM_MANAGE_EXPECTED_DELIVERIES
from backend.core.deps import get_db, require_permission
from backend.crud import clients as crud_clients
from backend.schemas import Client, ClientCreate

router = APIRouter()


@router.get("/", response_model=List[Client])
def get_clients(skip: int = 0, limit: int = 500, db: Session = Depends(get_db)):
    """Get all clients."""
    return crud_clients.get_clients(db, skip=skip, limit=limit)


@router.get("/{client_id}", response_model=Client)
def get_client(client_id: int, db: Session = Depends(get_db)):
    """Get a client by ID."""
    client = crud_clients.get_client(db, client_id)
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")
    return client


@router.post("/", response_model=Client, status_code=status.HTTP_201_CREATED)
def create_client(
    payload: ClientCreate,
    db: Session = Depends(get_db),
    _user=Depends(require_permission(PERM_MANAGE_EXPECTED_DELIVERIES)),
):
    """Create a client (returns the existing one if the name already exists, case-insensitively)."""
    if not payload.name.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Name is required")
    return crud_clients.get_or_create_client(db, payload.name)
