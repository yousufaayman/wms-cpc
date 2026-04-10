from sqlalchemy.orm import Session
from typing import Any, List, Mapping, Optional, Union
from ..models import User
from ..core.security import get_password_hash


def get_user(db: Session, id: int) -> Optional[User]:
    return db.query(User).filter(User.id == id).first()


def get_user_by_username(db: Session, username: str) -> Optional[User]:
    return db.query(User).filter(User.username == username).first()


def get_users(db: Session, *, skip: int = 0, limit: int = 100) -> List[User]:
    return db.query(User).offset(skip).limit(limit).all()


def _to_update_dict(obj_in: Any) -> dict[str, Any]:
    if isinstance(obj_in, Mapping):
        return dict(obj_in)
    if hasattr(obj_in, "model_dump"):
        return obj_in.model_dump(exclude_unset=True)
    if hasattr(obj_in, "dict"):
        return obj_in.dict(exclude_unset=True)
    raise TypeError("Unsupported payload type")


def create_user(db: Session, *, obj_in: Any) -> User:
    data = _to_update_dict(obj_in)
    db_obj = User(
        username=data["username"],
        password_hash=get_password_hash(data["password"])
    )
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj


def update_user(
    db: Session, *, db_obj: User, obj_in: Union[Mapping[str, Any], Any]
) -> User:
    update_data = _to_update_dict(obj_in)
    
    if update_data.get("password"):
        hashed_password = get_password_hash(update_data["password"])
        del update_data["password"]
        update_data["password_hash"] = hashed_password
    
    for field in update_data:
        setattr(db_obj, field, update_data[field])
    
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj


def delete_user(db: Session, *, id: int) -> User:
    obj = db.query(User).get(id)
    db.delete(obj)
    db.commit()
    return obj
