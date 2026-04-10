from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..crud import user_roles
from ..models import User


def user_has_admin_role(db: Session, user: User) -> bool:
    roles = user_roles.get_user_roles_by_user(db, user_id=user.id)
    return any(role.role == "admin" for role in roles)


def ensure_superuser(db: Session, user: User) -> User:
    if not user_has_admin_role(db, user):
        raise HTTPException(
            status_code=400,
            detail="The user doesn't have enough privileges",
        )
    return user
