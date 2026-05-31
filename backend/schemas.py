from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum

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

# Enums
class WarehouseType(str, Enum):
    FABRIC = "Fabric"
    RMG = "RMG"
    ACCESSORY = "Accessory"

class LogicalLocationType(str, Enum):
    SUPPLIER = "supplier"
    INTERNAL = "internal"

class SingleTransactionType(str, Enum):
    EXTERNAL = "external"
    INTERNAL = "internal"

class ItemType(str, Enum):
    FABRIC = "Fabric"
    RMG = "RMG"
    ACCESSORY = "Accessory"

# User schemas
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
    sub: Optional[str] = None
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
    client_id: int
    barcode: str = Field(..., min_length=1, max_length=100)
    weight: Optional[float] = Field(None, ge=0)
    received: bool = Field(default=False)
    carton_number: Optional[int] = None
    shipment_id: Optional[int] = None

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
        return v if v is not None else []

    class Config:
        from_attributes = True

class BoxAggregation(BoxAggregationBase):
    pass

# Box Content schemas
class BoxContentBase(BaseModel):
    box_id: int
    job_order_item_id: Optional[int] = None
    model_id: Optional[int] = None
    color_id: Optional[int] = None
    size_id: Optional[int] = None
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

# Logical Location schemas
class LogicalLocationBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    contact_name: Optional[str] = Field(None, max_length=100)
    contact_number: Optional[str] = Field(None, max_length=20)
    location_type: LogicalLocationType = LogicalLocationType.INTERNAL
    supplier_type: Optional[str] = Field(None, max_length=100)

class LogicalLocationCreate(LogicalLocationBase):
    pass

class LogicalLocationUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    contact_name: Optional[str] = Field(None, max_length=100)
    contact_number: Optional[str] = Field(None, max_length=20)
    location_type: Optional[LogicalLocationType] = None
    supplier_type: Optional[str] = Field(None, max_length=100)

class LogicalLocationInDB(LogicalLocationBase):
    id: int

    class Config:
        from_attributes = True

class LogicalLocation(LogicalLocationInDB):
    pass

# ── Supplier Receipt schemas ────────────────────────────────────────────────

class SupplierReceiptBase(BaseModel):
    source_warehouse_id: int
    target_logical_location_id: int
    remarks: Optional[str] = None

class SupplierReceiptCreate(SupplierReceiptBase):
    pass

class SupplierReceiptUpdate(BaseModel):
    source_warehouse_id: Optional[int] = None
    target_logical_location_id: Optional[int] = None
    remarks: Optional[str] = None

class SupplierReceiptClose(BaseModel):
    closed_by: int

class SupplierReceiptInDB(SupplierReceiptBase):
    id: int
    closed: bool
    status: str
    issued_by: Optional[int] = None
    closed_by: Optional[int] = None
    issued_at: datetime
    closed_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class SupplierReceipt(SupplierReceiptInDB):
    pass

# ── Internal Receipt schemas ────────────────────────────────────────────────

class InternalReceiptBase(BaseModel):
    source_warehouse_id: int
    target_logical_location_id: int

class InternalReceiptCreate(InternalReceiptBase):
    pass

class InternalReceiptUpdate(BaseModel):
    source_warehouse_id: Optional[int] = None
    target_logical_location_id: Optional[int] = None

class InternalReceiptConfirm(BaseModel):
    confirmed_by: int

class InternalReceiptClose(BaseModel):
    closed_by: int

class InternalReceiptInDB(InternalReceiptBase):
    id: int
    closed: bool
    status: str
    issued_by: Optional[int] = None
    closed_by: Optional[int] = None
    issued_at: datetime
    confirmed_by: Optional[int] = None

    class Config:
        from_attributes = True

class InternalReceipt(InternalReceiptInDB):
    pass

# ── External Receipt schemas ────────────────────────────────────────────────

class ExternalReceiptBase(BaseModel):
    source_warehouse_id: int
    receiver: str = Field(..., min_length=1, max_length=255)

class ExternalReceiptCreate(ExternalReceiptBase):
    pass

class ExternalReceiptUpdate(BaseModel):
    source_warehouse_id: Optional[int] = None
    receiver: Optional[str] = Field(None, min_length=1, max_length=255)

class ExternalReceiptClose(BaseModel):
    closed_by: int

class ExternalReceiptInDB(ExternalReceiptBase):
    id: int
    closed: bool
    status: str
    issued_by: Optional[int] = None
    closed_by: Optional[int] = None
    issued_at: datetime
    closed_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class ExternalReceipt(ExternalReceiptInDB):
    pass

# ── Fabric Receipt Item schemas ─────────────────────────────────────────────

_FABRIC_ITEM_TYPES = ("FabricRoll", "UndyedFabricRoll")

class FabricReceiptItemBase(BaseModel):
    item_type: str = Field(..., description="FabricRoll | UndyedFabricRoll")
    dyed_roll_id: Optional[int] = None
    undyed_roll_id: Optional[int] = None

    @field_validator("item_type")
    @classmethod
    def validate_item_type(cls, v: str) -> str:
        if v not in _FABRIC_ITEM_TYPES:
            raise ValueError(f"item_type must be one of {_FABRIC_ITEM_TYPES}")
        return v

class FabricReceiptItemCreate(FabricReceiptItemBase):
    pass

class FabricReceiptItemInDB(FabricReceiptItemBase):
    id: int
    supplier_receipt_id: Optional[int] = None
    internal_receipt_id: Optional[int] = None
    external_receipt_id: Optional[int] = None

    class Config:
        from_attributes = True

class FabricReceiptItem(FabricReceiptItemInDB):
    pass

# ── Box Receipt Item schemas ─────────────────────────────────────────────────

class BoxReceiptItemBase(BaseModel):
    box_id: Optional[int] = None

class BoxReceiptItemCreate(BoxReceiptItemBase):
    pass

class BoxReceiptItemInDB(BoxReceiptItemBase):
    id: int
    supplier_receipt_id: Optional[int] = None
    internal_receipt_id: Optional[int] = None
    external_receipt_id: Optional[int] = None

    class Config:
        from_attributes = True

class BoxReceiptItem(BoxReceiptItemInDB):
    pass

# ── Accessory Receipt Item schemas ───────────────────────────────────────────

class AccessoryReceiptItemBase(BaseModel):
    accessory_item_id: Optional[int] = None

class AccessoryReceiptItemCreate(AccessoryReceiptItemBase):
    pass

class AccessoryReceiptItemInDB(AccessoryReceiptItemBase):
    id: int
    supplier_receipt_id: Optional[int] = None
    internal_receipt_id: Optional[int] = None
    external_receipt_id: Optional[int] = None

    class Config:
        from_attributes = True

class AccessoryReceiptItem(AccessoryReceiptItemInDB):
    pass

# ── Single Transaction schemas ──────────────────────────────────────────────

class SingleTransactionBase(BaseModel):
    type: SingleTransactionType
    warehouse_id: int
    logical_location_id: Optional[int] = None
    receiver_name: Optional[str] = Field(None, max_length=255)
    item_type: ItemType
    item_id: int
    remarks: Optional[str] = None

class SingleTransactionCreate(SingleTransactionBase):
    pass

class SingleTransactionUpdate(BaseModel):
    type: Optional[SingleTransactionType] = None
    warehouse_id: Optional[int] = None
    logical_location_id: Optional[int] = None
    receiver_name: Optional[str] = Field(None, max_length=255)
    item_type: Optional[ItemType] = None
    item_id: Optional[int] = None
    remarks: Optional[str] = None

class SingleTransactionInDB(SingleTransactionBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True

class SingleTransaction(SingleTransactionInDB):
    pass

# ── Material schemas ────────────────────────────────────────────────────────

class MaterialBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)

class MaterialInDB(MaterialBase):
    id: int

    class Config:
        from_attributes = True

class Material(MaterialInDB):
    pass

# ── Client Fabric Code schemas ──────────────────────────────────────────────

class ClientFabricCodeBase(BaseModel):
    client_id: int
    color_id: int
    material_id: int
    fabric_code: Optional[str] = Field(None, max_length=100)

class ClientFabricCodeCreate(ClientFabricCodeBase):
    pass

class ClientFabricCodeUpdate(BaseModel):
    client_id: Optional[int] = None
    color_id: Optional[int] = None
    material_id: Optional[int] = None
    fabric_code: Optional[str] = Field(None, max_length=100)

class ClientFabricCodeInDB(ClientFabricCodeBase):
    id: int

    class Config:
        from_attributes = True

class ClientFabricCode(ClientFabricCodeInDB):
    pass

# ── Lot schemas ─────────────────────────────────────────────────────────────

class LotBase(BaseModel):
    client_fabric_code_id: int
    lot_number: str = Field(..., min_length=1, max_length=50)

class LotCreate(LotBase):
    pass

class LotUpdate(BaseModel):
    client_fabric_code_id: Optional[int] = None
    lot_number: Optional[str] = Field(None, min_length=1, max_length=50)

class LotInDB(LotBase):
    id: int

    class Config:
        from_attributes = True

class Lot(LotInDB):
    pass

class LotWithDetails(Lot):
    client_fabric_code: Optional[ClientFabricCode] = None

_ROLL_STATUS_PATTERN = "^(in|out)$"

# ── Dyed Fabric Roll schemas ────────────────────────────────────────────────

class DyedFabricRollBase(BaseModel):
    client_fabric_code_id: int
    lot_id: Optional[int] = None
    gsm: Optional[float] = Field(None, ge=0)
    fabric_width: Optional[float] = Field(None, ge=0)
    weight: float = Field(..., ge=0)
    length: Optional[float] = Field(None, ge=0)
    status: str = Field(default="in", pattern=_ROLL_STATUS_PATTERN)
    rack_id: Optional[int] = None
    defect_points: Optional[int] = Field(None, ge=0)
    quality_grade: Optional[str] = Field(None, max_length=20)
    received_date: Optional[datetime] = None
    issued_date: Optional[datetime] = None
    supplier: Optional[str] = Field(None, max_length=100)
    remarks: Optional[str] = None

class DyedFabricRollCreate(DyedFabricRollBase):
    pass

class DyedFabricRollUpdate(BaseModel):
    client_fabric_code_id: Optional[int] = None
    lot_id: Optional[int] = None
    gsm: Optional[float] = Field(None, ge=0)
    fabric_width: Optional[float] = Field(None, ge=0)
    weight: Optional[float] = Field(None, ge=0)
    length: Optional[float] = Field(None, ge=0)
    status: Optional[str] = Field(None, pattern=_ROLL_STATUS_PATTERN)
    rack_id: Optional[int] = None
    defect_points: Optional[int] = Field(None, ge=0)
    quality_grade: Optional[str] = Field(None, max_length=20)
    received_date: Optional[datetime] = None
    issued_date: Optional[datetime] = None
    supplier: Optional[str] = Field(None, max_length=100)
    remarks: Optional[str] = None

class DyedFabricRollInDB(DyedFabricRollBase):
    id: int

    class Config:
        from_attributes = True

class DyedFabricRoll(DyedFabricRollInDB):
    pass

class DyedFabricRollWithDetails(DyedFabricRoll):
    client_fabric_code: Optional[ClientFabricCode] = None
    lot: Optional[Lot] = None

class FabricRollDetail(BaseModel):
    id: int
    weight: float
    length: Optional[float] = None
    status: str
    material_name: str
    color_name: str
    lot_number: Optional[str] = None
    client_fabric_code_id: int

# ── Undyed Fabric Roll schemas ──────────────────────────────────────────────

class UndyedFabricRollBase(BaseModel):
    client_id: int
    material_id: int
    lot_number: Optional[str] = Field(None, max_length=50)
    gsm: Optional[float] = Field(None, ge=0)
    fabric_width: Optional[float] = Field(None, ge=0)
    weight: float = Field(..., ge=0)
    length: Optional[float] = Field(None, ge=0)
    status: str = Field(default="in", pattern=_ROLL_STATUS_PATTERN)
    rack_id: Optional[int] = None
    defect_points: Optional[int] = Field(None, ge=0)
    quality_grade: Optional[str] = Field(None, max_length=20)
    received_date: Optional[datetime] = None
    issued_date: Optional[datetime] = None
    supplier: Optional[str] = Field(None, max_length=100)
    remarks: Optional[str] = None

class UndyedFabricRollCreate(UndyedFabricRollBase):
    pass

class UndyedFabricRollUpdate(BaseModel):
    client_id: Optional[int] = None
    material_id: Optional[int] = None
    lot_number: Optional[str] = Field(None, max_length=50)
    gsm: Optional[float] = Field(None, ge=0)
    fabric_width: Optional[float] = Field(None, ge=0)
    weight: Optional[float] = Field(None, ge=0)
    length: Optional[float] = Field(None, ge=0)
    status: Optional[str] = Field(None, pattern=_ROLL_STATUS_PATTERN)
    rack_id: Optional[int] = None
    defect_points: Optional[int] = Field(None, ge=0)
    quality_grade: Optional[str] = Field(None, max_length=20)
    received_date: Optional[datetime] = None
    issued_date: Optional[datetime] = None
    supplier: Optional[str] = Field(None, max_length=100)
    remarks: Optional[str] = None

class UndyedFabricRollInDB(UndyedFabricRollBase):
    id: int

    class Config:
        from_attributes = True

class UndyedFabricRoll(UndyedFabricRollInDB):
    pass

class UndyedFabricRollWithDetails(UndyedFabricRoll):
    client: Optional[Client] = None
    material: Optional[Material] = None

# ── Inventory view schemas ──────────────────────────────────────────────────

class InventoryRollDetail(BaseModel):
    id: int
    weight: float
    length: Optional[float] = None
    gsm: Optional[float] = None
    fabric_width: Optional[float] = None
    status: str
    received_date: Optional[datetime] = None
    issued_date: Optional[datetime] = None
    rack_id: Optional[int] = None
    rack_code: Optional[str] = None
    quality_grade: Optional[str] = None
    defect_points: Optional[int] = None
    remarks: Optional[str] = None

    class Config:
        from_attributes = True


class InventoryLotGroup(BaseModel):
    lot_id: Optional[int] = None
    lot_number: Optional[str] = None
    supplier: Optional[str] = None
    total_weight: float
    total_length: Optional[float] = None
    roll_count: int
    rolls: List["InventoryRollDetail"]


class FabricCodeInventory(BaseModel):
    client_fabric_code_id: int
    fabric_code: Optional[str] = None
    color_id: int
    color_name: str
    total_weight: float
    total_length: Optional[float] = None
    roll_count: int
    lot_groups: List[InventoryLotGroup]


class MaterialInventoryGroup(BaseModel):
    material_id: int
    material_name: str
    total_weight: float
    total_length: Optional[float] = None
    roll_count: int
    fabric_codes: List[FabricCodeInventory]


class ClientInventoryGroup(BaseModel):
    client_id: int
    client_name: str
    total_weight: float
    total_length: Optional[float] = None
    roll_count: int
    materials: List[MaterialInventoryGroup]


class UndyedInventoryRollDetail(BaseModel):
    id: int
    weight: float
    length: Optional[float] = None
    gsm: Optional[float] = None
    fabric_width: Optional[float] = None
    status: str
    received_date: Optional[datetime] = None
    issued_date: Optional[datetime] = None
    rack_id: Optional[int] = None
    rack_code: Optional[str] = None
    quality_grade: Optional[str] = None
    defect_points: Optional[int] = None
    remarks: Optional[str] = None

    class Config:
        from_attributes = True


class UndyedInventoryLotGroup(BaseModel):
    lot_number: Optional[str] = None
    supplier: Optional[str] = None
    total_weight: float
    total_length: Optional[float] = None
    roll_count: int
    rolls: List["UndyedInventoryRollDetail"]


class UndyedMaterialInventory(BaseModel):
    material_id: int
    material_name: str
    total_weight: float
    total_length: Optional[float] = None
    roll_count: int
    lot_groups: List[UndyedInventoryLotGroup]


class UndyedClientInventoryGroup(BaseModel):
    client_id: int
    client_name: str
    total_weight: float
    total_length: Optional[float] = None
    roll_count: int
    materials: List[UndyedMaterialInventory]
