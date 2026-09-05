from typing import Any, List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend import models, schemas
from backend.crud import users as users_crud
from backend.core.deps import get_db, get_current_active_superuser

router = APIRouter()


@router.get("/", response_model=List[schemas.User])
def read_users(
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 500,
    current_user: models.User = Depends(get_current_active_superuser),
) -> Any:
    """
    Retrieve all users (admin only). Used to assign WMS roles; role
    assignment itself goes through /user-roles.
    """
    return users_crud.get_users(db, skip=skip, limit=limit)


@router.post("/", response_model=schemas.User, status_code=status.HTTP_201_CREATED)
def create_user(
    *,
    db: Session = Depends(get_db),
    user_in: schemas.UserCreate,
    current_user: models.User = Depends(get_current_active_superuser),
) -> Any:
    """
    Create a new user (admin only). This user is shared across every system
    (core.users) but starts with no role anywhere, including this one — grant
    WMS access via POST /user-roles afterwards.
    """
    if users_crud.get_user_by_username(db, username=user_in.username):
        raise HTTPException(
            status_code=400,
            detail="A user with this username already exists.",
        )
    return users_crud.create_user(db, obj_in=user_in)
