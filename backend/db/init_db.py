from sqlalchemy import text
from ..database import engine
from ..models import Base, User, UserType
from ..core.security import get_password_hash
from sqlalchemy.orm import Session
from .. import crud, schemas
from ..core.config import settings

def init_db() -> None:
    # Create tables
    Base.metadata.create_all(bind=engine)
    # Create initial admin user
    create_initial_admin()

def create_initial_admin() -> None:
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        # Check if admin user exists
        admin = db.query(User).filter(User.username == "admin").first()
        if not admin:
            # Create admin user
            admin_in = schemas.UserCreate(
                username="admin",
                password="admin123",
                type=schemas.UserType.ADMIN
            )
            crud.create_user(db, obj_in=admin_in)
    finally:
        db.close()
