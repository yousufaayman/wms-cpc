from pydantic import BaseModel, Field, EmailStr, field_validator
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum

# Note: System schemas removed

# User Role schemas
class UserRoleBase(BaseModel):
    user_id: int
    system_id: int
    role: str = Field(..., min_length=1, max_length=50)

class UserRoleCreate(UserRoleBase):
    pass

class UserRoleUpdate(BaseModel):
    role: Optional[str] = Field(None, min_length=1, max_length=50)

class UserRoleInDB(UserRoleBase):
    id: int

    class Config:
        from_attributes = True

class UserRole(UserRoleInDB):
    pass

# Note: UserRoleWithSystem removed due to System model removal

# Warehouse schemas
class WarehouseType(str, Enum):
    FABRIC = "Fabric"
    RMG = "RMG"
    ACCESSORY = "Accessory"

# Receipt schemas
class ReceiptType(str, Enum):
    INBOUND = "inbound"
    DYEHOUSE = "dyehouse"
    CUTTING = "cutting"
    SHIPPING = "shipping"

class ReceiptStatus(str, Enum):
    ISSUED = "issued"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"

# Transaction schemas
class TransactionType(str, Enum):
    IN = "IN"
    OUT = "OUT"

class UserBase(BaseModel):
    username: str = Field(..., min_length=1, max_length=50)

class UserCreate(UserBase):
    password: str

class UserUpdate(BaseModel):
    username: Optional[str] = Field(None, min_length=1, max_length=50)
    password: Optional[str] = None

class UserInDB(UserBase):
    id: int

    class Config:
        from_attributes = True

class User(UserInDB):
    pass

class UserWithRoles(User):
    user_roles: List[UserRole] = []

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

# Core schema models
class ClientBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)

class ClientCreate(ClientBase):
    pass

class ClientUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)

class ClientInDB(ClientBase):
    id: int

    class Config:
        from_attributes = True

class Client(ClientInDB):
    pass

class ModelBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)

class ModelCreate(ModelBase):
    pass

class ModelUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)

class ModelInDB(ModelBase):
    id: int

    class Config:
        from_attributes = True

class Model(ModelInDB):
    pass

class ColorBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)

class ColorCreate(ColorBase):
    pass

class ColorUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)

class ColorInDB(ColorBase):
    id: int

    class Config:
        from_attributes = True

class Color(ColorInDB):
    pass

class SizeBase(BaseModel):
    value: str = Field(..., min_length=1, max_length=100)

class SizeCreate(SizeBase):
    pass

class SizeUpdate(BaseModel):
    value: Optional[str] = Field(None, min_length=1, max_length=100)

class SizeInDB(SizeBase):
    id: int

    class Config:
        from_attributes = True

class Size(SizeInDB):
    pass

# Box schemas
class BoxBase(BaseModel):
    rack_id: Optional[int] = None
    client_id: int  # reference to core.clients
    barcode: str = Field(..., min_length=1, max_length=100)
    weight: Optional[float] = Field(None, ge=0)  # weight in kg, must be >= 0
    received: bool = Field(default=False)  # indicates whether the box has been received
    carton_number: Optional[int] = None  # carton number for the box
    shipment_id: Optional[int] = None  # ID of the shipment this box belongs to

class BoxCreate(BoxBase):
    pass

class BoxUpdate(BaseModel):
    rack_id: Optional[int] = None
    client_id: Optional[int] = None
    barcode: Optional[str] = Field(None, min_length=1, max_length=100)
    weight: Optional[float] = Field(None, ge=0)
    received: Optional[bool] = None
    carton_number: Optional[int] = None
    shipment_id: Optional[int] = None

class BoxInDB(BoxBase):
    id: int

    class Config:
        from_attributes = True

class Box(BoxInDB):
    pass

class BoxWithRack(Box):
    rack: Optional[WarehouseRack] = None

class BoxWithClient(Box):
    client: Optional[Client] = None

class BoxWithDetails(Box):
    client: Optional[Client] = None
    rack: Optional[WarehouseRack] = None

# Box Aggregation schemas for database-level aggregations
class BoxAggregationBase(BaseModel):
    box_id: int
    barcode: str
    rack_id: Optional[int] = None
    client_id: int
    box_weight: Optional[float] = None
    received: bool = False
    carton_number: Optional[int] = None
    shipment_id: Optional[int] = None
    rack_code: Optional[str] = None
    client_name: Optional[str] = None
    total_pieces: int = 0
    distinct_items: int = 0
    distinct_models: int = 0
    distinct_colors: int = 0
    distinct_sizes: int = 0
    model_names: List[str] = []
    color_names: List[str] = []
    size_values: List[str] = []
    job_order_item_ids: Optional[List[int]] = []
    total_content_weight: float = 0.0
    max_piece_count: Optional[int] = None
    min_piece_count: Optional[int] = None
    avg_piece_count: Optional[float] = None

    @field_validator('job_order_item_ids', 'model_names', 'color_names', 'size_values', mode='before')
    @classmethod
    def handle_none_lists(cls, v):
        """Convert None values to empty lists for array fields."""
        return v if v is not None else []
    
    class Config:
        from_attributes = True

class BoxAggregation(BoxAggregationBase):
    pass

# Box Content schemas
class BoxContentBase(BaseModel):
    box_id: int
    job_order_item_id: Optional[int] = None  # reference to core.job_order_items
    model_id: Optional[int] = None  # reference to core.models
    color_id: Optional[int] = None  # reference to core.colors
    size_id: Optional[int] = None  # reference to core.sizes
    piece_count: int = Field(..., ge=0)
    weight: Optional[float] = Field(None, ge=0)

class BoxContentCreate(BoxContentBase):
    pass

class BoxContentUpdate(BaseModel):
    job_order_item_id: Optional[int] = None
    model_id: Optional[int] = None
    color_id: Optional[int] = None
    size_id: Optional[int] = None
    piece_count: Optional[int] = Field(None, ge=0)
    weight: Optional[float] = Field(None, ge=0)

class BoxContentInDB(BoxContentBase):
    id: int

    class Config:
        from_attributes = True

class BoxContent(BoxContentInDB):
    pass

class BoxContentWithDetails(BoxContent):
    job_order_item: Optional[Dict[str, Any]] = None
    model: Optional[Model] = None
    color: Optional[Color] = None
    size: Optional[Size] = None

# Job Order Item schemas
class JobOrderItemBase(BaseModel):
    job_order_id: int
    color_id: int
    size_id: int
    quantity: int
    weight: Optional[float] = None

class JobOrderItemCreate(JobOrderItemBase):
    pass

class JobOrderItemUpdate(BaseModel):
    job_order_id: Optional[int] = None
    color_id: Optional[int] = None
    size_id: Optional[int] = None
    quantity: Optional[int] = None
    weight: Optional[float] = None

class JobOrderItemInDB(JobOrderItemBase):
    id: int

    class Config:
        from_attributes = True

class JobOrderItem(JobOrderItemInDB):
    pass

class JobOrderItemWithDetails(JobOrderItem):
    job_order: Optional[Dict[str, Any]] = None
    color: Optional[Color] = None
    size: Optional[Size] = None

# Receipt schemas
class ReceiptBase(BaseModel):
    receipt_type: ReceiptType
    source_location_id: Optional[int] = None
    target_location_id: Optional[int] = None
    status: ReceiptStatus = ReceiptStatus.ISSUED
    closed: bool = Field(default=False)  # indicates whether the receipt has been closed
    reference_receipt_id: Optional[int] = None  # references another receipt

class ReceiptCreate(ReceiptBase):
    pass

class ReceiptUpdate(BaseModel):
    receipt_type: Optional[ReceiptType] = None
    source_location_id: Optional[int] = None
    target_location_id: Optional[int] = None
    status: Optional[ReceiptStatus] = None
    closed: Optional[bool] = None
    reference_receipt_id: Optional[int] = None
    confirmed_by: Optional[int] = None

class ReceiptInDB(ReceiptBase):
    id: int
    issued_by: int
    confirmed_by: Optional[int] = None
    issued_at: datetime
    confirmed_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class Receipt(ReceiptInDB):
    pass

# Receipt Item schemas
class ReceiptItemBase(BaseModel):
    receipt_id: int
    roll_id: Optional[int] = None
    box_id: Optional[int] = None

class ReceiptItemCreate(ReceiptItemBase):
    pass

class ReceiptItemUpdate(BaseModel):
    roll_id: Optional[int] = None
    box_id: Optional[int] = None

class ReceiptItemInDB(ReceiptItemBase):
    id: int

    class Config:
        from_attributes = True

class ReceiptItem(ReceiptItemInDB):
    pass

# Logical Location schemas
class LogicalLocationBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    contact_name: Optional[str] = Field(None, max_length=100)
    contact_number: Optional[str] = Field(None, max_length=20)

class LogicalLocationCreate(LogicalLocationBase):
    pass

class LogicalLocationUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    contact_name: Optional[str] = Field(None, max_length=100)
    contact_number: Optional[str] = Field(None, max_length=20)

class LogicalLocationInDB(LogicalLocationBase):
    id: int

    class Config:
        from_attributes = True

class LogicalLocation(LogicalLocationInDB):
    pass

# Single Transaction schemas
class SingleTransactionBase(BaseModel):
    user_id: int
    receiver_name: str = Field(..., min_length=1, max_length=255)
    purpose: str = Field(..., min_length=1, max_length=255)
    piece_count: int = Field(..., ge=0)
    transaction_type: TransactionType
    reference_id: Optional[int] = None

class SingleTransactionCreate(SingleTransactionBase):
    pass

class SingleTransactionUpdate(BaseModel):
    receiver_name: Optional[str] = Field(None, min_length=1, max_length=255)
    purpose: Optional[str] = Field(None, min_length=1, max_length=255)
    piece_count: Optional[int] = Field(None, ge=0)
    transaction_type: Optional[TransactionType] = None
    reference_id: Optional[int] = None

class SingleTransactionInDB(SingleTransactionBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True

class SingleTransaction(SingleTransactionInDB):
    pass