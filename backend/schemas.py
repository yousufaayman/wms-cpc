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

# Warehouse schemas
class WarehouseType(str, Enum):
    FABRIC = "Fabric"
    RMG = "RMG"
    ACCESSORY = "Accessory"

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

# Warehouse schemas
class WarehouseBase(BaseModel):
    name: str
    type: WarehouseType

class WarehouseCreate(WarehouseBase):
    pass

class WarehouseUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[WarehouseType] = None

class WarehouseInDB(WarehouseBase):
    id: int

    class Config:
        from_attributes = True

class Warehouse(WarehouseInDB):
    pass

# Warehouse Rack schemas
class WarehouseRackBase(BaseModel):
    warehouse_id: int
    rack_code: str = Field(..., min_length=1, max_length=50)

class WarehouseRackCreate(WarehouseRackBase):
    pass

class WarehouseRackUpdate(BaseModel):
    warehouse_id: Optional[int] = None
    rack_code: Optional[str] = Field(None, min_length=1, max_length=50)

class WarehouseRackInDB(WarehouseRackBase):
    id: int

    class Config:
        from_attributes = True

class WarehouseRack(WarehouseRackInDB):
    pass

class WarehouseRackWithWarehouse(WarehouseRack):
    warehouse: Warehouse