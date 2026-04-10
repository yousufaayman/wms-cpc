from sqlalchemy.orm import Session
from typing import Any, List, Mapping, Optional, Union
from ..models import UserRole


def _to_update_dict(obj_in: Any) -> dict[str, Any]:
    if isinstance(obj_in, Mapping):
        return dict(obj_in)
    if hasattr(obj_in, "model_dump"):
        return obj_in.model_dump(exclude_unset=True)
    if hasattr(obj_in, "dict"):
        return obj_in.dict(exclude_unset=True)
    raise TypeError("Unsupported payload type")


def get_user_role(db: Session, id: int) -> Optional[UserRole]:
    return db.query(UserRole).filter(UserRole.id == id).first()


def get_user_roles_by_user(db: Session, user_id: int) -> List[UserRole]:
    return db.query(UserRole).filter(UserRole.user_id == user_id).all()


def get_user_roles_by_system(db: Session, system_id: int) -> List[UserRole]:
    return db.query(UserRole).filter(UserRole.system_id == system_id).all()


def get_user_role_by_user_and_system(db: Session, user_id: int, system_id: int) -> Optional[UserRole]:
    return db.query(UserRole).filter(
        UserRole.user_id == user_id,
        UserRole.system_id == system_id
    ).first()


def get_user_roles(db: Session, *, skip: int = 0, limit: int = 100) -> List[UserRole]:
    return db.query(UserRole).offset(skip).limit(limit).all()


def create_user_role(db: Session, *, obj_in: Any) -> UserRole:
    data = _to_update_dict(obj_in)
    db_obj = UserRole(
        user_id=data["user_id"],
        system_id=data["system_id"],
        role=data["role"],
    )
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj


def update_user_role(
    db: Session, *, db_obj: UserRole, obj_in: Union[Mapping[str, Any], Any]
) -> UserRole:
    update_data = _to_update_dict(obj_in)
    
    for field in update_data:
        setattr(db_obj, field, update_data[field])
    
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj


def delete_user_role(db: Session, *, id: int) -> UserRole:
    obj = db.query(UserRole).get(id)
    db.delete(obj)
    db.commit()
    return obj


def delete_user_roles_by_user(db: Session, *, user_id: int) -> List[UserRole]:
    roles = db.query(UserRole).filter(UserRole.user_id == user_id).all()
    for role in roles:
        db.delete(role)
    db.commit()
    return roles
