from sqlalchemy import Column, Integer, String, ForeignKey, Boolean, DateTime, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.ext.declarative import declarative_base
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import enum

Base = declarative_base()

class UserType(str, enum.Enum):
    ADMIN = "admin"
    WAREHOUSE = "warehouse"
    INSPECTOR = "inspector"
    OPERATOR = "operator"

# User model (matches provided SQL schema)
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    type = Column(Enum(UserType, values_callable=lambda x: [e.value for e in UserType]), nullable=False)

    def __repr__(self):
        return f"<User {self.username}>"

class TokenPayload(BaseModel):
    sub: Optional[int] = None
    exp: Optional[datetime] = None