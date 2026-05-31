from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from backend.core.deps import get_db
from backend.crud import clients as crud_clients
from backend.schemas import Client

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
