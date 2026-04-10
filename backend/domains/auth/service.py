from datetime import timedelta
from typing import List

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ... import models, schemas
from ...core import security
from ...core.config import settings
from ...crud import user_roles, users


def create_user(db: Session, user_in: schemas.UserCreate) -> models.User:
    existing = users.get_user_by_username(db, username=user_in.username)
    if existing:
        raise HTTPException(
            status_code=400,
            detail="The user with this username already exists in the system.",
        )
    return users.create_user(db, obj_in=user_in)


def authenticate_and_issue_token(db: Session, username: str, password: str) -> schemas.Token:
    user = users.get_user_by_username(db, username=username)
    if not user or not security.verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return schemas.Token(
        access_token=security.create_access_token(
            user.username, expires_delta=access_token_expires
        ),
        token_type="bearer",
    )


def get_current_user_profile(db: Session, current_user: models.User) -> schemas.UserWithRoles:
    roles = user_roles.get_user_roles_by_user(db, user_id=current_user.id)
    return schemas.UserWithRoles(
        id=current_user.id,
        username=current_user.username,
        user_roles=roles,
    )


def get_users_with_roles(
    db: Session, skip: int = 0, limit: int = 100
) -> List[schemas.UserWithRoles]:
    users_list = users.get_users(db, skip=skip, limit=limit)
    response: List[schemas.UserWithRoles] = []
    for user in users_list:
        roles = user_roles.get_user_roles_by_user(db, user_id=user.id)
        response.append(
            schemas.UserWithRoles(id=user.id, username=user.username, user_roles=roles)
        )
    return response


def ensure_user_exists(db: Session, user_id: int) -> models.User:
    user = users.get_user(db, id=user_id)
    if not user:
        raise HTTPException(
            status_code=404,
            detail="The user with this ID does not exist in the system",
        )
    return user


def update_user(db: Session, user: models.User, user_in: schemas.UserUpdate) -> models.User:
    return users.update_user(db, db_obj=user, obj_in=user_in)


def delete_user(db: Session, user_id: int) -> models.User:
    ensure_user_exists(db, user_id)
    return users.delete_user(db, id=user_id)
