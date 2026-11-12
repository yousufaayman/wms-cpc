from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional, List, Dict, Any, Literal
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
    PRODUCTION_LINE = "production_line"

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

# Accessory units, conversions, categories (item 7). Codes are stored upper-case
# and can't be changed after creation (category codes are part of item codes).
def _upper_code(v: str) -> str:
    return v.strip().upper() if isinstance(v, str) else v

def _strip(v):
    return v.strip() if isinstance(v, str) else v

class UomCreate(BaseModel):
    code: str = Field(..., pattern=r"^[A-Z0-9]{1,10}$")
    name_en: str = Field(..., min_length=1, max_length=50)
    name_ar: str = Field(..., min_length=1, max_length=50)
    allows_decimals: bool = False

    _norm_code = field_validator("code", mode="before")(_upper_code)
    _norm_names = field_validator("name_en", "name_ar", mode="before")(_strip)

class UomUpdate(BaseModel):
    name_en: Optional[str] = Field(None, min_length=1, max_length=50)
    name_ar: Optional[str] = Field(None, min_length=1, max_length=50)
    allows_decimals: Optional[bool] = None
    active: Optional[bool] = None

    _norm_names = field_validator("name_en", "name_ar", mode="before")(_strip)

class Uom(BaseModel):
    id: int
    code: str
    name_en: str
    name_ar: str
    allows_decimals: bool
    active: bool

    class Config:
        from_attributes = True

class UomConversionCreate(BaseModel):
    from_uom_id: int
    to_uom_id: int
    factor: float = Field(..., gt=0, lt=100_000_000)

class UomConversionUpdate(BaseModel):
    factor: float = Field(..., gt=0, lt=100_000_000)

class UomConversion(BaseModel):
    id: int
    from_uom_id: int
    to_uom_id: int
    factor: float
    accessory_item_id: Optional[int] = None  # None = global

    class Config:
        from_attributes = True

class AccessoryCategoryCreate(BaseModel):
    code: str = Field(..., pattern=r"^[A-Z]{2,5}$")
    name_en: str = Field(..., min_length=1, max_length=100)
    name_ar: str = Field(..., min_length=1, max_length=100)
    default_uom_id: int
    default_client_specific: bool = False

    _norm_code = field_validator("code", mode="before")(_upper_code)
    _norm_names = field_validator("name_en", "name_ar", mode="before")(_strip)

class AccessoryCategoryUpdate(BaseModel):
    name_en: Optional[str] = Field(None, min_length=1, max_length=100)
    name_ar: Optional[str] = Field(None, min_length=1, max_length=100)
    default_uom_id: Optional[int] = None
    default_client_specific: Optional[bool] = None
    active: Optional[bool] = None

    _norm_names = field_validator("name_en", "name_ar", mode="before")(_strip)

class AccessoryCategory(BaseModel):
    id: int
    code: str
    name_en: str
    name_ar: str
    default_uom_id: int
    default_client_specific: bool
    active: bool

    class Config:
        from_attributes = True

# Accessory items (item 8). The code is generated by the server; category and
# client are part of it, so they're only accepted on create.
def _blank_to_none(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v

class AccessoryItemRefIn(BaseModel):
    """A client's or supplier's code for the item: set exactly one of client_id / supplier_id."""
    client_id: Optional[int] = None
    supplier_id: Optional[int] = None
    ref_code: str = Field(..., min_length=1, max_length=100)
    ref_description: Optional[str] = Field(None, max_length=255)

    _norm_code = field_validator("ref_code", mode="before")(_strip)
    _norm_desc = field_validator("ref_description", mode="before")(_blank_to_none)

    @model_validator(mode="after")
    def _one_party(self):
        if (self.client_id is None) == (self.supplier_id is None):
            raise ValueError("Set either client_id or supplier_id")
        return self

class AccessoryItemRefUpdate(BaseModel):
    """Fix a typo in the code or description; the party can't change."""
    ref_code: Optional[str] = Field(None, min_length=1, max_length=100)
    ref_description: Optional[str] = Field(None, max_length=255)

    _norm_code = field_validator("ref_code", mode="before")(_strip)
    _norm_desc = field_validator("ref_description", mode="before")(_blank_to_none)

class AccessoryItemRef(BaseModel):
    id: int
    accessory_item_id: int
    client_id: Optional[int] = None
    supplier_id: Optional[int] = None
    ref_code: str
    ref_description: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

class AccessoryItemCreate(BaseModel):
    category_id: int
    client_id: Optional[int] = None  # None = generic
    description: str = Field(..., min_length=1, max_length=255)
    color: Optional[str] = Field(None, max_length=100)
    size: Optional[str] = Field(None, max_length=50)
    base_uom_id: int
    # A new item needs at least one client or supplier code (item 9).
    refs: List[AccessoryItemRefIn] = Field(..., min_length=1)

    _norm_desc = field_validator("description", mode="before")(_strip)
    _norm_opt = field_validator("color", "size", mode="before")(_blank_to_none)

class AccessoryItemUpdate(BaseModel):
    """Only the fields sent are changed; send color/size as null or "" to clear them."""
    description: Optional[str] = Field(None, min_length=1, max_length=255)
    color: Optional[str] = Field(None, max_length=100)
    size: Optional[str] = Field(None, max_length=50)
    base_uom_id: Optional[int] = None
    active: Optional[bool] = None
    # Variants only: the full new set of values (blank = leave a line empty).
    variable_values: Optional[Dict[str, Optional[str]]] = None

    _norm_desc = field_validator("description", mode="before")(_strip)
    _norm_opt = field_validator("color", "size", mode="before")(_blank_to_none)

# Templates + variants (item 10)
FieldType = Literal["text", "number", "money", "date"]

class AccessoryItemFieldCreate(BaseModel):
    """A variable line on a template. The key is made from the English label."""
    label_en: str = Field(..., min_length=1, max_length=100)
    label_ar: str = Field(..., min_length=1, max_length=100)
    field_type: FieldType
    required: bool = False
    print_order: int = 0

    _norm = field_validator("label_en", "label_ar", mode="before")(_strip)

class AccessoryItemFieldUpdate(BaseModel):
    label_en: Optional[str] = Field(None, min_length=1, max_length=100)
    label_ar: Optional[str] = Field(None, min_length=1, max_length=100)
    field_type: Optional[FieldType] = None
    required: Optional[bool] = None
    print_order: Optional[int] = None

    _norm = field_validator("label_en", "label_ar", mode="before")(_strip)

class AccessoryItemField(BaseModel):
    id: int
    accessory_item_id: int
    field_key: str
    label_en: str
    label_ar: str
    field_type: str
    required: bool
    print_order: int

    class Config:
        from_attributes = True

class AccessoryValueLine(BaseModel):
    field_key: str
    label_en: str
    label_ar: str
    value: str

class AccessoryVariantCreate(BaseModel):
    """One combination of values for a template. Category, client, base unit
    and (unless given) description come from the template; references are
    optional (the template's apply)."""
    values: Dict[str, Optional[str]] = {}
    color: Optional[str] = Field(None, max_length=100)
    size: Optional[str] = Field(None, max_length=50)
    description: Optional[str] = Field(None, max_length=255)
    refs: List[AccessoryItemRefIn] = []

    _norm_opt = field_validator("color", "size", "description", mode="before")(_blank_to_none)

class AccessoryItem(BaseModel):
    id: int
    code: str
    category_id: int
    client_id: Optional[int] = None
    description: str
    color: Optional[str] = None
    size: Optional[str] = None
    base_uom_id: int
    active: bool
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    refs: List[AccessoryItemRef] = []
    # Item 10
    is_template: bool = False
    variant_count: int = 0
    fields: List[AccessoryItemField] = []  # a template's variable lines
    parent_template_id: Optional[int] = None
    template_code: Optional[str] = None
    variable_values: Optional[Dict[str, str]] = None
    value_lines: List[AccessoryValueLine] = []  # a variant's values, labelled, in print order

    class Config:
        from_attributes = True

class AccessoryItemSearch(BaseModel):
    """Filters of the Accessory Items list (item 11). Every one given must match.

    q: quick search, each word found in any field. Text filters are "contains",
    ignoring case. ref_client_id / ref_supplier_id narrow the reference filter
    to one party. line: "key:text" entries, one template line each (e.g.
    "po_number:451" = that line contains 451). Read from the query string.
    """
    q: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    size: Optional[str] = None
    ref_code: Optional[str] = None
    ref_client_id: Optional[int] = None
    ref_supplier_id: Optional[int] = None
    base_uom_id: Optional[int] = None
    line_value: Optional[str] = None
    line: List[str] = Field(default_factory=list)
    category_id: Optional[int] = None
    client_id: Optional[int] = None
    generic_only: bool = False
    active_only: bool = True
    kind: Optional[Literal["plain", "template", "variant"]] = None
    template_id: Optional[int] = None
    sort: Literal["code", "newest"] = "code"
    # Variants folded under their base: list only plain items and bases; a
    # base is listed when it or one of its variants matches (item 11).
    group_variants: bool = False
    limit: int = Field(50, ge=1, le=500)
    offset: int = Field(0, ge=0)

    @property
    def lines(self) -> Dict[str, str]:
        """`line` as {line key: text}; entries without a colon are ignored."""
        return dict(entry.split(":", 1) for entry in self.line if ":" in entry)


class AccessoryItemPage(BaseModel):
    items: List[AccessoryItem]
    total: int

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

class MaterialCreate(MaterialBase):
    pass

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


class FabricCodeLookupResult(BaseModel):
    client_fabric_code_id: int
    fabric_code: Optional[str] = None
    client_id: int
    client_name: str
    material_id: int
    material_name: str
    color_id: int
    color_name: str
    # Currently in-stock dyed rolls for this fabric code (status 'in')
    in_stock_weight: float
    in_stock_length: Optional[float] = None
    in_stock_rolls: int

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
    # Roll lineage: this roll was split/re-ingested from another dyed roll.
    # Optional — not yet surfaced in the ingestion UI.
    original_roll_id: Optional[int] = None

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
    original_roll_id: Optional[int] = None

class DyedFabricRollInDB(DyedFabricRollBase):
    id: int
    expected_delivery_item_id: Optional[int] = None
    # Set server-side from the authenticated user at creation — never client-supplied.
    ingested_by: Optional[int] = None

    class Config:
        from_attributes = True

class DyedFabricRoll(DyedFabricRollInDB):
    # Set transiently by CRUD when the roll was auto-matched to an expected
    # delivery on creation; never stored on the roll itself.
    matched_delivery_id: Optional[int] = None

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
    fabric_code: Optional[str] = None
    client_name: Optional[str] = None
    gsm: Optional[float] = None
    fabric_width: Optional[float] = None
    rack_code: Optional[str] = None
    supplier: Optional[str] = None
    received_date: Optional[datetime] = None

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
    expected_delivery_item_id: Optional[int] = None
    # Set server-side from the authenticated user at creation — never client-supplied.
    ingested_by: Optional[int] = None

    class Config:
        from_attributes = True

class UndyedFabricRoll(UndyedFabricRollInDB):
    # Set transiently by CRUD when the roll was auto-matched to an expected
    # delivery on creation; never stored on the roll itself.
    matched_delivery_id: Optional[int] = None

class UndyedFabricRollWithDetails(UndyedFabricRoll):
    client: Optional[Client] = None
    material: Optional[Material] = None

class UndyedFabricRollDetail(BaseModel):
    """Scan-lookup projection mirroring FabricRollDetail (no color/fabric code)."""
    id: int
    weight: float
    length: Optional[float] = None
    status: str
    material_name: str
    lot_number: Optional[str] = None
    client_id: int
    material_id: int
    client_name: Optional[str] = None
    gsm: Optional[float] = None
    fabric_width: Optional[float] = None
    rack_code: Optional[str] = None
    supplier: Optional[str] = None
    received_date: Optional[datetime] = None


# ── Rack contents (scan quick-view) schemas ─────────────────────────────────

class RackDyedGroup(BaseModel):
    """Dyed rolls in a rack, grouped by fabric code + lot."""
    client_fabric_code_id: int
    fabric_code: Optional[str] = None
    client_name: str
    material_name: str
    color_name: str
    lot_number: Optional[str] = None
    roll_count: int
    total_weight: float
    total_length: Optional[float] = None


class RackUndyedGroup(BaseModel):
    """Undyed rolls in a rack, grouped by client + material + lot."""
    client_id: int
    client_name: str
    material_id: int
    material_name: str
    lot_number: Optional[str] = None
    roll_count: int
    total_weight: float
    total_length: Optional[float] = None


class RackContents(BaseModel):
    rack_id: int
    rack_code: str
    warehouse_id: int
    roll_count: int
    total_weight: float
    dyed_groups: List[RackDyedGroup]
    undyed_groups: List[RackUndyedGroup]

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
    original_roll_id: Optional[int] = None

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


# ── Roll flow analytics schemas (per day, direction, counterparty, identity) ──

class RollFlowEntryBase(BaseModel):
    # ISO day (YYYY-MM-DD); null when the roll is missing the relevant date
    date: Optional[str] = None
    direction: str  # 'ingested' | 'digested'
    # Ingested: the roll's supplier (a client or an actual supplier);
    # digested: who received the roll. Null when unknown.
    counterparty: Optional[str] = None
    client_id: int
    client_name: str
    material_id: int
    material_name: str
    total_weight: float
    total_length: float
    roll_count: int


class DyedRollFlowEntry(RollFlowEntryBase):
    client_fabric_code_id: int
    fabric_code: Optional[str] = None
    color_id: int
    color_name: str


class UndyedRollFlowEntry(RollFlowEntryBase):
    pass


# ── Account flow analytics schemas (per logical location) ────────────────────

class FlowAccount(BaseModel):
    # Null for 'external' accounts — external receivers are identified by name
    id: Optional[int] = None
    name: str
    account_type: str  # 'location' | 'client' | 'external'


class AccountFlowRoll(BaseModel):
    roll_id: int
    roll_type: str  # 'dyed' | 'undyed'
    # ISO day (YYYY-MM-DD); null when the source timestamp is missing
    date: Optional[str] = None
    receipt_kind: Optional[str] = None  # 'supplier' | 'internal' (digested only)
    receipt_id: Optional[int] = None
    fabric_code: Optional[str] = None
    client_fabric_code_id: Optional[int] = None
    client_name: str
    material_name: str
    color_name: Optional[str] = None
    weight: float
    length: Optional[float] = None


class AccountFlow(BaseModel):
    account_id: Optional[int] = None  # null for 'external' accounts
    account_name: str
    account_type: str  # 'location' | 'client' | 'external'
    ingested: List[AccountFlowRoll]
    digested: List[AccountFlowRoll]


# ── Expected Delivery schemas ────────────────────────────────────────────────

class ExpectedDeliveryItemBase(BaseModel):
    # Exactly one of these must be set (enforced by DB check constraint)
    client_fabric_code_id: Optional[int] = None  # dyed fabric path
    client_id: Optional[int] = None              # undyed fabric path (with material_id)
    material_id: Optional[int] = None            # undyed fabric path
    expected_weight_kg: Optional[float] = Field(None, ge=0)
    expected_length_m: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = None

    @model_validator(mode="after")
    def validate_exactly_one_type(self) -> "ExpectedDeliveryItemBase":
        has_cfc = self.client_fabric_code_id is not None
        has_mat = self.material_id is not None
        if has_cfc == has_mat:
            raise ValueError("Exactly one of client_fabric_code_id (dyed) or material_id (undyed) must be set")
        if has_mat and self.client_id is None:
            raise ValueError("client_id is required for undyed items (material_id set)")
        if has_cfc and self.client_id is not None:
            raise ValueError("client_id must not be set for dyed items (the fabric code already carries the client)")
        return self


class ExpectedDeliveryItemCreate(ExpectedDeliveryItemBase):
    pass


class ExpectedDeliveryItemUpdate(BaseModel):
    # received_weight_kg / received_length_m are deliberately absent: they are
    # derived from the roll ledger (rolls.expected_delivery_item_id) and can
    # only change by linking/unlinking/editing rolls.
    client_fabric_code_id: Optional[int] = None
    client_id: Optional[int] = None
    material_id: Optional[int] = None
    expected_weight_kg: Optional[float] = Field(None, ge=0)
    expected_length_m: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = None


class ExpectedDeliveryItemInDB(ExpectedDeliveryItemBase):
    id: int
    delivery_id: int
    received_weight_kg: float
    received_length_m: float
    client_fabric_code: Optional[ClientFabricCode] = None
    client: Optional[Client] = None
    material: Optional[Material] = None

    class Config:
        from_attributes = True


class ExpectedDeliveryItem(ExpectedDeliveryItemInDB):
    pass


SupplierType = Literal["client", "logical_location"]


class ExpectedDeliveryBase(BaseModel):
    # Polymorphic supplier reference: id into core.clients or
    # wms.logical_locations depending on supplier_type. Both set or both null;
    # existence is validated in CRUD (no DB-level FK possible).
    client_supplier_id: Optional[int] = None
    supplier_type: Optional[SupplierType] = None
    warehouse_id: Optional[int] = None
    expected_date: Optional[datetime] = None
    notes: Optional[str] = None

    @model_validator(mode="after")
    def validate_supplier_pair(self) -> "ExpectedDeliveryBase":
        if (self.client_supplier_id is None) != (self.supplier_type is None):
            raise ValueError("client_supplier_id and supplier_type must both be set or both be null")
        return self


class ExpectedDeliveryCreate(ExpectedDeliveryBase):
    pass


class ExpectedDeliveryUpdate(BaseModel):
    client_supplier_id: Optional[int] = None
    supplier_type: Optional[SupplierType] = None
    warehouse_id: Optional[int] = None
    expected_date: Optional[datetime] = None
    status: Optional[str] = Field(None, pattern="^(pending|partial|received|cancelled)$")
    notes: Optional[str] = None


class ExpectedDeliveryInDB(ExpectedDeliveryBase):
    id: int
    status: str
    # Display name resolved at read time from the supplier reference
    supplier_name: Optional[str] = None
    created_by: Optional[int] = None
    created_at: datetime
    closed_at: Optional[datetime] = None
    closed_by: Optional[int] = None
    items: List[ExpectedDeliveryItem] = []

    class Config:
        from_attributes = True


class ExpectedDelivery(ExpectedDeliveryInDB):
    pass


# ── Job Order Material Request schemas ───────────────────────────────────────

MeasurementScale = Literal["KG", "M"]


class MaterialRequestFabricCode(BaseModel):
    """Fabric code with the display details the material requests page needs."""

    id: int
    fabric_code: Optional[str] = None
    material_id: int
    color_id: int
    client_id: int
    material: Optional[Material] = None
    color: Optional[Color] = None
    client: Optional[Client] = None

    class Config:
        from_attributes = True


class MaterialRequestJobOrder(BaseModel):
    id: int
    job_order_number: str
    client_id: int
    client: Optional[Client] = None
    notes: Optional[str] = None
    date_created: Optional[datetime] = None
    priority: Optional[int] = None

    class Config:
        from_attributes = True


class JobOrderMaterialRequestBase(BaseModel):
    job_order_id: int
    panel_type: str = Field(..., min_length=1, max_length=100)
    consumption: float = Field(..., ge=0)
    quantity: Optional[float] = Field(None, ge=0)
    measurement_scale: MeasurementScale = "KG"
    fabric_code_id: int


class JobOrderMaterialRequestCreate(JobOrderMaterialRequestBase):
    pass


class JobOrderMaterialRequestInDB(JobOrderMaterialRequestBase):
    id: int
    fulfilled: bool
    fabric_code: Optional[MaterialRequestFabricCode] = None
    job_order: Optional[MaterialRequestJobOrder] = None

    class Config:
        from_attributes = True


class JobOrderMaterialRequest(JobOrderMaterialRequestInDB):
    pass


class MaterialRequestForceFulfill(BaseModel):
    fulfilled: bool


# ── Material Request Fulfillment schemas ─────────────────────────────────────

class MRFNestedReceipt(BaseModel):
    """Slim receipt reference embedded in a fulfillment for display."""

    id: int
    source_warehouse_id: int
    target_logical_location_id: Optional[int] = None
    status: str
    issued_at: datetime

    class Config:
        from_attributes = True


class MaterialRequestFulfillmentBase(BaseModel):
    material_request_id: int
    internal_receipt_id: Optional[int] = None
    supplier_receipt_id: Optional[int] = None
    external_receipt_id: Optional[int] = None
    quantity_issued: Optional[float] = Field(None, ge=0)
    measurement_scale: Optional[str] = Field(None, max_length=50)
    notes: Optional[str] = None

    @model_validator(mode="after")
    def validate_at_most_one_receipt(self) -> "MaterialRequestFulfillmentBase":
        refs = [self.internal_receipt_id, self.supplier_receipt_id, self.external_receipt_id]
        if sum(r is not None for r in refs) > 1:
            raise ValueError("A fulfillment may reference at most one receipt")
        return self


class MaterialRequestFulfillmentCreate(MaterialRequestFulfillmentBase):
    pass


class MaterialRequestFulfillmentUpdate(BaseModel):
    quantity_issued: Optional[float] = Field(None, ge=0)
    measurement_scale: Optional[str] = Field(None, max_length=50)
    notes: Optional[str] = None


class MaterialRequestFulfillmentInDB(MaterialRequestFulfillmentBase):
    id: int
    created_at: datetime
    internal_receipt: Optional[MRFNestedReceipt] = None

    class Config:
        from_attributes = True


class MaterialRequestFulfillment(MaterialRequestFulfillmentInDB):
    pass
