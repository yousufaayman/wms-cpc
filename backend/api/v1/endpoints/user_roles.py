from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend import models, schemas
from backend.crud import user_roles
from backend.core.deps import get_db, get_current_active_superuser
from backend.domains.auth import service as auth_service

router = APIRouter()

@router.get("/", response_model=List[schemas.UserRole])
def read_user_roles(
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 100,
    current_user: models.User = Depends(get_current_active_superuser),
) -> Any:
    """
    Retrieve user roles.
    """
    roles = user_roles.get_user_roles(db, skip=skip, limit=limit)
    return roles

@router.get("/user/{user_id}", response_model=List[schemas.UserRole])
def read_user_roles_by_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_superuser),
) -> Any:
    """
    Retrieve user roles for a specific user.
    """
    roles = user_roles.get_user_roles_by_user(db, user_id=user_id)
    return roles

@router.get("/system/{system_id}", response_model=List[schemas.UserRole])
def read_user_roles_by_system(
    system_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_superuser),
) -> Any:
    """
    Retrieve user roles for a specific system.
    """
    roles = user_roles.get_user_roles_by_system(db, system_id=system_id)
    return roles

@router.post("/", response_model=schemas.UserRole)
def create_user_role(
    *,
    db: Session = Depends(get_db),
    user_role_in: schemas.UserRoleCreate,
    current_user: models.User = Depends(get_current_active_superuser),
) -> Any:
    """
    Create new user role.
    """
    # Check if user exists
    auth_service.ensure_user_exists(db, user_role_in.user_id)
    
    # Note: System validation removed - system_id is assumed to exist
    
    # Check if role already exists for this user-system combination
    existing_role = user_roles.get_user_role_by_user_and_system(
        db, user_id=user_role_in.user_id, system_id=user_role_in.system_id
    )
    if existing_role:
        raise HTTPException(
            status_code=400,
            detail="A role for this user-system combination already exists.",
        )
    
    user_role = user_roles.create_user_role(db, obj_in=user_role_in)
    return user_role

@router.put("/{user_role_id}", response_model=schemas.UserRole)
def update_user_role(
    *,
    db: Session = Depends(get_db),
    user_role_id: int,
    user_role_in: schemas.UserRoleUpdate,
    current_user: models.User = Depends(get_current_active_superuser),
) -> Any:
    """
    Update a user role.
    """
    user_role = user_roles.get_user_role(db, id=user_role_id)
    if not user_role:
        raise HTTPException(
            status_code=404,
            detail="The user role with this ID does not exist in the system",
        )
    user_role = user_roles.update_user_role(db, db_obj=user_role, obj_in=user_role_in)
    return user_role

@router.delete("/{user_role_id}", response_model=schemas.UserRole)
def delete_user_role(
    *,
    db: Session = Depends(get_db),
    user_role_id: int,
    current_user: models.User = Depends(get_current_active_superuser),
) -> Any:
    """
    Delete a user role.
    """
    user_role = user_roles.get_user_role(db, id=user_role_id)
    if not user_role:
        raise HTTPException(
            status_code=404,
            detail="The user role with this ID does not exist in the system",
        )
    user_role = user_roles.delete_user_role(db, id=user_role_id)
    return user_role
