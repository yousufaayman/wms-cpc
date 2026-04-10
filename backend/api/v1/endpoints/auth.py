from typing import Any
from fastapi import APIRouter, Depends
from fastapi.security import OAuth2PasswordRequestForm, OAuth2PasswordBearer
from sqlalchemy.orm import Session

from backend import models, schemas
from backend.core.deps import get_db, get_current_user, get_current_active_user, get_current_active_superuser
from backend.domains.auth import service as auth_service

router = APIRouter()

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/v1/auth/login")

@router.post("/register", response_model=schemas.User)
def register(
    *,
    db: Session = Depends(get_db),
    user_in: schemas.UserCreate,
) -> Any:
    """
    Create new user.
    """
    return auth_service.create_user(db, user_in)

@router.post("/login", response_model=schemas.Token)
def login(
    db: Session = Depends(get_db),
    form_data: OAuth2PasswordRequestForm = Depends()
) -> Any:
    """
    OAuth2 compatible token login, get an access token for future requests
    """
    return auth_service.authenticate_and_issue_token(
        db, username=form_data.username, password=form_data.password
    )

@router.get("/me", response_model=schemas.UserWithRoles)
def read_users_me(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> Any:
    """
    Get current user with roles.
    """
    return auth_service.get_current_user_profile(db, current_user)

@router.put("/me", response_model=schemas.User)
def update_user_me(
    *,
    db: Session = Depends(get_db),
    user_in: schemas.UserUpdate,
    current_user: models.User = Depends(get_current_active_user),
) -> Any:
    """
    Update own user.
    """
    return auth_service.update_user(db, current_user, user_in)

# Admin only endpoints
@router.get("/users", response_model=list[schemas.UserWithRoles])
def read_users(
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 100,
    current_user: models.User = Depends(get_current_active_superuser),
) -> Any:
    """
    Retrieve users with their roles.
    """
    return auth_service.get_users_with_roles(db, skip=skip, limit=limit)

@router.post("/users", response_model=schemas.User)
def create_user_endpoint(
    *,
    db: Session = Depends(get_db),
    user_in: schemas.UserCreate,
    current_user: models.User = Depends(get_current_active_superuser),
) -> Any:
    """
    Create new user.
    """
    return auth_service.create_user(db, user_in)

@router.put("/users/{user_id}", response_model=schemas.User)
def update_user_endpoint(
    *,
    db: Session = Depends(get_db),
    user_id: int,
    user_in: schemas.UserUpdate,
    current_user: models.User = Depends(get_current_active_superuser),
) -> Any:
    """
    Update a user.
    """
    user = auth_service.ensure_user_exists(db, user_id)
    return auth_service.update_user(db, user, user_in)

@router.delete("/users/{user_id}", response_model=schemas.User)
def delete_user_endpoint(
    *,
    db: Session = Depends(get_db),
    user_id: int,
    current_user: models.User = Depends(get_current_active_superuser),
) -> Any:
    """
    Delete a user.
    """
    return auth_service.delete_user(db, user_id)