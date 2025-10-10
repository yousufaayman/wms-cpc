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

class WarehouseType(str, enum.Enum):
    FABRIC = "Fabric"
    RMG = "RMG"
    ACCESSORY = "Accessory"

# User model (matches provided SQL schema)
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    type = Column(Enum(UserType, values_callable=lambda x: [e.value for e in UserType]), nullable=False)

    def __repr__(self):
        return f"<User {self.username}>"

# Warehouse model (matches provided SQL schema)
class Warehouse(Base):
    __tablename__ = "warehouses"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(100), unique=True, nullable=False)
    type = Column(Enum(WarehouseType, values_callable=lambda x: [e.value for e in WarehouseType]), nullable=False)
    
    # Relationship with warehouse racks
    racks = relationship("WarehouseRack", back_populates="warehouse")

    def __repr__(self):
        return f"<Warehouse {self.name}>"

# Warehouse Rack model (matches provided SQL schema)
class WarehouseRack(Base):
    __tablename__ = "warehouse_racks"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    rack_code = Column(String(50), nullable=False)
    
    # Relationship with warehouse
    warehouse = relationship("Warehouse", back_populates="racks")

    def __repr__(self):
        return f"<WarehouseRack {self.rack_code} in warehouse {self.warehouse_id}>"

class TokenPayload(BaseModel):
    sub: Optional[int] = None
    exp: Optional[datetime] = None