from sqlalchemy import Column, Integer, String, ForeignKey, Boolean, DateTime, TIMESTAMP
from sqlalchemy.dialects.postgresql import NUMERIC, ENUM
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.ext.declarative import declarative_base
from typing import TYPE_CHECKING
import enum

Base = declarative_base()

# Create PostgreSQL ENUM types with explicit schema
warehouse_type_enum = ENUM('Fabric', 'RMG', 'Accessory', name='warehouse_type', schema='wms', create_type=False)
receipt_type_enum = ENUM('inbound', 'dyehouse', 'cutting', 'shipping', name='receipt_type', schema='wms', create_type=False)
receipt_status_enum = ENUM('issued', 'confirmed', 'cancelled', name='receipt_status', schema='wms', create_type=False)
transaction_type_enum = ENUM('IN', 'OUT', name='transaction_type', schema='wms', create_type=False)

class WarehouseType(str, enum.Enum):
    FABRIC = "Fabric"
    RMG = "RMG"
    ACCESSORY = "Accessory"

class ReceiptType(str, enum.Enum):
    INBOUND = "inbound"
    DYEHOUSE = "dyehouse"
    CUTTING = "cutting"
    SHIPPING = "shipping"

class ReceiptStatus(str, enum.Enum):
    ISSUED = "issued"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"

class TransactionType(str, enum.Enum):
    IN = "IN"
    OUT = "OUT"

# Note: System model removed

# Core schema models
class Client(Base):
    __tablename__ = "clients"
    __table_args__ = {'schema': 'core'}

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    
    # Relationship with boxes
    boxes = relationship("Box", back_populates="client")

    def __repr__(self):
        return f"<Client {self.name}>"

class Model(Base):
    __tablename__ = "models"
    __table_args__ = {'schema': 'core'}

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    
    # Relationship with box contents
    box_contents = relationship("BoxContent", back_populates="model")

    def __repr__(self):
        return f"<Model {self.name}>"

class Color(Base):
    __tablename__ = "colors"
    __table_args__ = {'schema': 'core'}

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    
    # Relationship with box contents
    box_contents = relationship("BoxContent", back_populates="color")

    def __repr__(self):
        return f"<Color {self.name}>"

class Size(Base):
    __tablename__ = "sizes"
    __table_args__ = {'schema': 'core'}

    id = Column(Integer, primary_key=True, index=True)
    value = Column(String(100), unique=True, nullable=False)
    
    # Relationship with box contents
    box_contents = relationship("BoxContent", back_populates="size")

    def __repr__(self):
        return f"<Size {self.value}>"

class JobOrder(Base):
    __tablename__ = "job_orders"
    __table_args__ = {'schema': 'core'}

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("core.clients.id"), nullable=False)
    order_number = Column(String(100), unique=True, nullable=False)
    
    # Relationships
    client = relationship("Client")
    job_order_items = relationship("JobOrderItem", back_populates="job_order")

    def __repr__(self):
        return f"<JobOrder {self.order_number}>"

class JobOrderItem(Base):
    __tablename__ = "job_order_items"
    __table_args__ = {'schema': 'core'}

    id = Column(Integer, primary_key=True, index=True)
    job_order_id = Column(Integer, ForeignKey("core.job_orders.id"), nullable=False)
    color_id = Column(Integer, ForeignKey("core.colors.id"), nullable=False)
    size_id = Column(Integer, ForeignKey("core.sizes.id"), nullable=False)
    quantity = Column(Integer, nullable=False)
    weight = Column(NUMERIC(10, 2), nullable=True)
    
    # Relationships
    job_order = relationship("JobOrder", back_populates="job_order_items")
    color = relationship("Color")
    size = relationship("Size")
    box_contents = relationship("BoxContent", back_populates="job_order_item")

    def __repr__(self):
        return f"<JobOrderItem {self.id} for job order {self.job_order_id}>"

# User model (matches new core.users table structure)
class User(Base):
    __tablename__ = "users"
    __table_args__ = {'schema': 'core'}

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    
    # Relationship with user roles
    user_roles = relationship("UserRole", back_populates="user")

    def __repr__(self):
        return f"<User {self.username}>"

# User Role model (matches new core.user_roles table structure)
class UserRole(Base):
    __tablename__ = "user_roles"
    __table_args__ = {'schema': 'core'}

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("core.users.id"), nullable=False)
    system_id = Column(Integer, ForeignKey("core.systems.id"), nullable=False)
    role = Column(String(50), nullable=False)
    
    # Relationships
    user = relationship("User", back_populates="user_roles")
    # Note: System relationship removed

    def __repr__(self):
        return f"<UserRole user_id={self.user_id} system_id={self.system_id} role={self.role}>"

# Warehouse model (matches provided SQL schema)
class Warehouse(Base):
    __tablename__ = "warehouses"
    __table_args__ = {'schema': 'wms'}

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    type = Column(warehouse_type_enum, nullable=False)
    
    # Relationship with warehouse racks
    racks = relationship("WarehouseRack", back_populates="warehouse")

    def __repr__(self):
        return f"<Warehouse {self.name}>"

# Warehouse Rack model (matches provided SQL schema)
class WarehouseRack(Base):
    __tablename__ = "warehouse_racks"
    __table_args__ = {'schema': 'wms'}

    id = Column(Integer, primary_key=True, index=True)
    warehouse_id = Column(Integer, ForeignKey("wms.warehouses.id"), nullable=False)
    rack_code = Column(String(50), nullable=False)
    
    # Relationship with warehouse
    warehouse = relationship("Warehouse", back_populates="racks")
    # Relationship with boxes
    boxes = relationship("Box", back_populates="rack")

    def __repr__(self):
        return f"<WarehouseRack {self.rack_code} in warehouse {self.warehouse_id}>"

# Box model (matches new core/wms schema)
class Box(Base):
    __tablename__ = "boxes"
    __table_args__ = {'schema': 'wms'}

    id = Column(Integer, primary_key=True, index=True)
    rack_id = Column(Integer, ForeignKey("wms.warehouse_racks.id"), nullable=True, default=None)  # optional physical location
    barcode = Column(String(100), unique=True, nullable=False)  # box barcode (packaging)
    client_id = Column(Integer, ForeignKey("core.clients.id"), nullable=False)  # reference to core.clients
    weight = Column(NUMERIC(10, 2), nullable=True)  # total gross weight of the box (kg)
    received = Column(Boolean, nullable=False, default=False)  # indicates whether the box has been received
    carton_number = Column(Integer, nullable=True)  # carton number for the box
    shipment_id = Column(Integer, nullable=True)  # ID of the shipment this box belongs to
    
    # Relationships
    rack = relationship("WarehouseRack", back_populates="boxes")
    contents = relationship("BoxContent", back_populates="box")
    client = relationship("Client", foreign_keys=[client_id])

    def __repr__(self):
        return f"<Box {self.barcode} in rack {self.rack_id}>"

# Box Content model (matches new core/wms schema)
class BoxContent(Base):
    __tablename__ = "box_contents"
    __table_args__ = {'schema': 'wms'}

    id = Column(Integer, primary_key=True, index=True)
    box_id = Column(Integer, ForeignKey("wms.boxes.id"), nullable=False)
    job_order_item_id = Column(Integer, ForeignKey("core.job_order_items.id"), nullable=True)
    model_id = Column(Integer, ForeignKey("core.models.id"), nullable=True)
    color_id = Column(Integer, ForeignKey("core.colors.id"), nullable=True)
    size_id = Column(Integer, ForeignKey("core.sizes.id"), nullable=True)
    piece_count = Column(Integer, nullable=False)
    weight = Column(NUMERIC(10, 2), nullable=True)
    
    # Relationships
    box = relationship("Box", back_populates="contents")
    job_order_item = relationship("JobOrderItem", back_populates="box_contents")
    model = relationship("Model", back_populates="box_contents")
    color = relationship("Color", back_populates="box_contents")
    size = relationship("Size", back_populates="box_contents")

    def __repr__(self):
        return f"<BoxContent {self.model_id} {self.color_id} {self.size_id} in box {self.box_id}>"

# Receipt model (matches provided SQL schema)
class Receipt(Base):
    __tablename__ = "receipts"
    __table_args__ = {'schema': 'wms'}

    id = Column(Integer, primary_key=True, index=True)
    receipt_type = Column(receipt_type_enum, nullable=False)
    source_location_id = Column(Integer, nullable=True)
    target_location_id = Column(Integer, nullable=True)
    status = Column(receipt_status_enum, nullable=False, default='issued')
    closed = Column(Boolean, nullable=False, default=False)  # indicates whether the receipt has been closed
    reference_receipt_id = Column(Integer, ForeignKey("wms.receipts.id"), nullable=True)  # references another receipt
    issued_by = Column(Integer, ForeignKey("core.users.id"), nullable=True)
    confirmed_by = Column(Integer, ForeignKey("core.users.id"), nullable=True)
    issued_at = Column(TIMESTAMP, default=func.current_timestamp())
    confirmed_at = Column(TIMESTAMP, nullable=True)
    
    # Relationships
    issuer = relationship("User", foreign_keys=[issued_by])
    confirmer = relationship("User", foreign_keys=[confirmed_by])
    items = relationship("ReceiptItem", back_populates="receipt")
    reference_receipt = relationship("Receipt", remote_side=[id])  # self-referential relationship

    def __repr__(self):
        return f"<Receipt {self.id} - {self.receipt_type}>"

# Receipt Item model (matches provided SQL schema)
class ReceiptItem(Base):
    __tablename__ = "receipt_items"
    __table_args__ = {'schema': 'wms'}

    id = Column(Integer, primary_key=True, index=True)
    receipt_id = Column(Integer, ForeignKey("wms.receipts.id"), nullable=False)
    roll_id = Column(Integer, nullable=True)
    box_id = Column(Integer, nullable=True)
    
    # Relationship with receipt
    receipt = relationship("Receipt", back_populates="items")

    def __repr__(self):
        return f"<ReceiptItem {self.id} for receipt {self.receipt_id}>"

# Logical Location model (matches provided SQL schema)
class LogicalLocation(Base):
    __tablename__ = "logical_locations"
    __table_args__ = {'schema': 'wms'}

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    contact_name = Column(String(100), nullable=True)
    contact_number = Column(String(20), nullable=True)

    def __repr__(self):
        return f"<LogicalLocation {self.name}>"

# Single Transaction model (matches provided SQL schema)
class SingleTransaction(Base):
    __tablename__ = "single_transactions"
    __table_args__ = {'schema': 'wms'}

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("core.users.id"), nullable=True)
    receiver_name = Column(String(255), nullable=False)
    purpose = Column(String(255), nullable=False)
    piece_count = Column(Integer, nullable=False)
    transaction_type = Column(transaction_type_enum, nullable=False)
    reference_id = Column(Integer, nullable=True)
    created_at = Column(TIMESTAMP, default=func.current_timestamp())
    
    # Relationship with user
    user = relationship("User")

    def __repr__(self):
        return f"<SingleTransaction {self.id} - {self.transaction_type} {self.piece_count} pieces>"

# Backward compatibility alias; canonical definition lives in backend.schemas.
if TYPE_CHECKING:
    from .schemas import TokenPayload as TokenPayload
else:
    from .schemas import TokenPayload  # type: ignore