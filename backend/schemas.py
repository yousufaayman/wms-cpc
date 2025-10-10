from pydantic import BaseModel, Field, EmailStr
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum

# User schemas
class UserType(str, Enum):
    ADMIN = "admin"
    WAREHOUSE = "warehouse"
    INSPECTOR = "inspector"
    OPERATOR = "operator"

class UserBase(BaseModel):
    username: str
    type: UserType

class UserCreate(UserBase):
    password: str

class UserUpdate(UserBase):
    password: Optional[str] = None

class UserInDB(UserBase):
    id: int

    class Config:
        from_attributes = True

class User(UserInDB):
    pass

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenPayload(BaseModel):
    sub: Optional[str] = None  # username
    exp: Optional[datetime] = None
