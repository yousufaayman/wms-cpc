from sqlalchemy import (
    Column,
    Integer,
    BigInteger,
    String,
    ForeignKey,
    Boolean,
    DateTime,
    TIMESTAMP,
    Text,
    UniqueConstraint,
    CheckConstraint,
)
from sqlalchemy.dialects.postgresql import NUMERIC, ENUM, JSONB
from sqlalchemy.orm import relationship, synonym
from sqlalchemy.sql import func
from sqlalchemy.ext.declarative import declarative_base
from typing import TYPE_CHECKING
import enum

Base = declarative_base()

_CASCADE_DELETE = "all, delete-orphan"
_ON_DELETE_SET_NULL = "SET NULL"
_ON_DELETE_CASCADE = "CASCADE"
_ON_DELETE_RESTRICT = "RESTRICT"

# Frequently referenced FK targets
_FK_CLIENTS       = "core.clients.client_id"
_FK_COLORS        = "core.colors.color_id"
_FK_USERS         = "core.users.id"
_FK_WAREHOUSES    = "wms.warehouses.id"
_FK_RACKS         = "wms.warehouse_racks.id"
_FK_LOG_LOCATIONS    = "wms.logical_locations.id"
_FK_CLIENT_FABRIC_CODES = "core.client_fabric_codes.id"
_FK_SUPPLIER_RECEIPTS  = "wms.supplier_receipts.id"
_FK_INTERNAL_RECEIPTS = "wms.internal_receipts.id"
_FK_EXTERNAL_RECEIPTS = "wms.external_receipts.id"

_CK_ONE_RECEIPT = (
    "CASE WHEN supplier_receipt_id IS NOT NULL THEN 1 ELSE 0 END + "
    "CASE WHEN internal_receipt_id IS NOT NULL THEN 1 ELSE 0 END + "
    "CASE WHEN external_receipt_id IS NOT NULL THEN 1 ELSE 0 END = 1"
)

# Create PostgreSQL ENUM types with explicit schema
warehouse_type_enum = ENUM('Fabric', 'RMG', 'Accessory', name='warehouse_type', schema='wms', create_type=False)
logical_location_type_enum = ENUM(
    'supplier', 'internal', name='logical_location_type', schema='wms', create_type=False
)

class WarehouseType(str, enum.Enum):
    FABRIC = "Fabric"
    RMG = "RMG"
    ACCESSORY = "Accessory"

class LogicalLocationType(str, enum.Enum):
    SUPPLIER = "supplier"
    INTERNAL = "internal"

# Note: System model removed

# Core schema models — column names match live DB (CPC_INTEGRATED_SYSTEM): PKs are client_id, color_id, etc.
class Client(Base):
    __tablename__ = "clients"
    __table_args__ = {'schema': 'core'}

    client_id = Column(Integer, primary_key=True, index=True)
    client_name = Column(String(100), unique=True, nullable=False)

    id = synonym("client_id")
    name = synonym("client_name")

    boxes = relationship("Box", back_populates="client")
    undyed_fabric_rolls = relationship("UndyedFabricRoll", back_populates="client")

    def __repr__(self):
        return f"<Client {self.client_name}>"


class Model(Base):
    __tablename__ = "models"
    __table_args__ = {'schema': 'core'}

    model_id = Column(Integer, primary_key=True, index=True)
    model_name = Column(String(100), unique=True, nullable=False)

    id = synonym("model_id")
    name = synonym("model_name")

    box_contents = relationship("BoxContent", back_populates="model")

    def __repr__(self):
        return f"<Model {self.model_name}>"


class Color(Base):
    __tablename__ = "colors"
    __table_args__ = {'schema': 'core'}

    color_id = Column(Integer, primary_key=True, index=True)
    color_name = Column(String(100), unique=True, nullable=False)

    id = synonym("color_id")
    name = synonym("color_name")

    box_contents = relationship("BoxContent", back_populates="color")

    def __repr__(self):
        return f"<Color {self.color_name}>"


class Size(Base):
    __tablename__ = "sizes"
    __table_args__ = {'schema': 'core'}

    size_id = Column(Integer, primary_key=True, index=True)
    size_value = Column(String(100), unique=True, nullable=False)

    id = synonym("size_id")
    value = synonym("size_value")

    box_contents = relationship("BoxContent", back_populates="size")

    def __repr__(self):
        return f"<Size {self.size_value}>"


class JobOrder(Base):
    __tablename__ = "job_orders"
    __table_args__ = {'schema': 'core'}

    job_order_id = Column(Integer, primary_key=True, index=True)
    model_id = Column(Integer, ForeignKey("core.models.model_id"), nullable=True)
    job_order_number = Column(String(100), nullable=False)
    client_id = Column(Integer, ForeignKey(_FK_CLIENTS), nullable=False)
    image_url = Column(String(500), nullable=True)
    notes = Column(Text, nullable=True)
    print_config = Column(JSONB, nullable=True)
    date_created = Column(TIMESTAMP, nullable=True)
    priority = Column(Integer, nullable=True)

    id = synonym("job_order_id")
    order_number = synonym("job_order_number")

    client = relationship("Client", foreign_keys=[client_id])
    model = relationship("Model", foreign_keys=[model_id])
    job_order_items = relationship("JobOrderItem", back_populates="job_order")
    material_requests = relationship("JobOrderMaterialRequest", back_populates="job_order")

    def __repr__(self):
        return f"<JobOrder {self.job_order_number}>"


class JobOrderItem(Base):
    __tablename__ = "job_order_items"
    __table_args__ = {'schema': 'core'}

    item_id = Column(Integer, primary_key=True, index=True)
    job_order_id = Column(Integer, ForeignKey("core.job_orders.job_order_id"), nullable=False)
    color_id = Column(Integer, ForeignKey(_FK_COLORS), nullable=False)
    size_id = Column(Integer, ForeignKey("core.sizes.size_id"), nullable=False)
    quantity = Column(Integer, nullable=False)
    weight = Column(NUMERIC(10, 2), nullable=True)
    notes = Column(Text, nullable=True)

    id = synonym("item_id")

    job_order = relationship("JobOrder", back_populates="job_order_items", foreign_keys=[job_order_id])
    color = relationship("Color", foreign_keys=[color_id])
    size = relationship("Size", foreign_keys=[size_id])
    box_contents = relationship("BoxContent", back_populates="job_order_item")

    def __repr__(self):
        return f"<JobOrderItem {self.item_id} for job order {self.job_order_id}>"


class Material(Base):
    __tablename__ = "materials"
    __table_args__ = {"schema": "core"}

    material_id = Column(Integer, primary_key=True, index=True)
    material_name = Column(String(100), unique=True, nullable=False)

    id = synonym("material_id")
    name = synonym("material_name")

    client_fabric_codes = relationship("ClientFabricCode", back_populates="material")
    undyed_fabric_rolls = relationship("UndyedFabricRoll", back_populates="material")

    def __repr__(self):
        return f"<Material {self.material_name}>"


class ClientFabricCode(Base):
    __tablename__ = "client_fabric_codes"
    __table_args__ = {"schema": "core"}

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey(_FK_CLIENTS, onupdate="CASCADE", ondelete="RESTRICT"), nullable=False)
    color_id = Column(Integer, ForeignKey(_FK_COLORS, onupdate="CASCADE", ondelete="RESTRICT"), nullable=False)
    material_id = Column(Integer, ForeignKey("core.materials.material_id", onupdate="CASCADE", ondelete="RESTRICT"), nullable=False)
    fabric_code = Column(String(100), nullable=True)

    client = relationship("Client", foreign_keys=[client_id])
    color = relationship("Color", foreign_keys=[color_id])
    material = relationship("Material", back_populates="client_fabric_codes", foreign_keys=[material_id])
    lots = relationship("Lot", back_populates="client_fabric_code")
    dyed_fabric_rolls = relationship("DyedFabricRoll", back_populates="client_fabric_code")

    def __repr__(self):
        return f"<ClientFabricCode {self.fabric_code} client={self.client_id}>"


# Job Order Material Request — fabric a job order needs, fulfilled from stock
class JobOrderMaterialRequest(Base):
    __tablename__ = "job_order_material_requests"
    __table_args__ = (
        UniqueConstraint("job_order_id", "fabric_code_id", "panel_type", name="uq_job_material_request"),
        CheckConstraint(
            "measurement_scale IN ('KG', 'M')",
            name="ck_job_material_request_measurement_scale",
        ),
        {"schema": "core"},
    )

    id = Column(Integer, primary_key=True, index=True)
    job_order_id = Column(Integer, ForeignKey("core.job_orders.job_order_id", ondelete=_ON_DELETE_CASCADE), nullable=False)
    panel_type = Column(String(100), nullable=False)
    consumption = Column(NUMERIC(10, 3), nullable=False)
    quantity = Column(NUMERIC(10, 3), nullable=True)
    measurement_scale = Column(String(10), nullable=False, default="KG")
    fabric_code_id = Column(Integer, ForeignKey(_FK_CLIENT_FABRIC_CODES, ondelete=_ON_DELETE_RESTRICT), nullable=False)
    fulfilled = Column(Boolean, nullable=False, default=False)

    job_order = relationship("JobOrder", back_populates="material_requests", foreign_keys=[job_order_id])
    fabric_code = relationship("ClientFabricCode", foreign_keys=[fabric_code_id])
    fulfillments = relationship("MaterialRequestFulfillment", back_populates="material_request", cascade=_CASCADE_DELETE)

    def __repr__(self):
        return f"<JobOrderMaterialRequest {self.id} job_order={self.job_order_id}>"


_CK_MRF_AT_MOST_ONE_RECEIPT = (
    "CASE WHEN internal_receipt_id IS NOT NULL THEN 1 ELSE 0 END + "
    "CASE WHEN supplier_receipt_id IS NOT NULL THEN 1 ELSE 0 END + "
    "CASE WHEN external_receipt_id IS NOT NULL THEN 1 ELSE 0 END <= 1"
)


# Material Request Fulfillment — ledger of quantities issued against a request.
# Linked to at most one receipt (any type); rows with no receipt are manual.
class MaterialRequestFulfillment(Base):
    __tablename__ = "material_request_fulfillments"
    __table_args__ = (
        CheckConstraint(_CK_MRF_AT_MOST_ONE_RECEIPT, name="ck_mrf_at_most_one_receipt"),
        {"schema": "core"},
    )

    id = Column(Integer, primary_key=True, index=True)
    material_request_id = Column(Integer, ForeignKey("core.job_order_material_requests.id", ondelete=_ON_DELETE_CASCADE), nullable=False, index=True)
    internal_receipt_id = Column(Integer, ForeignKey(_FK_INTERNAL_RECEIPTS, ondelete=_ON_DELETE_RESTRICT), nullable=True, index=True)
    supplier_receipt_id = Column(Integer, ForeignKey(_FK_SUPPLIER_RECEIPTS, ondelete=_ON_DELETE_RESTRICT), nullable=True, index=True)
    external_receipt_id = Column(Integer, ForeignKey(_FK_EXTERNAL_RECEIPTS, ondelete=_ON_DELETE_RESTRICT), nullable=True, index=True)
    quantity_issued = Column(NUMERIC(10, 4), nullable=True)
    measurement_scale = Column(String(50), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP, nullable=False, default=func.current_timestamp())

    material_request = relationship("JobOrderMaterialRequest", back_populates="fulfillments", foreign_keys=[material_request_id])
    internal_receipt = relationship("InternalReceipt", foreign_keys=[internal_receipt_id])
    supplier_receipt = relationship("SupplierReceipt", foreign_keys=[supplier_receipt_id])
    external_receipt = relationship("ExternalReceipt", foreign_keys=[external_receipt_id])

    def __repr__(self):
        return f"<MaterialRequestFulfillment {self.id} request={self.material_request_id}>"


# User model (matches new core.users table structure)
class User(Base):
    __tablename__ = "users"
    __table_args__ = {'schema': 'core'}

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)

    user_roles = relationship("UserRole", back_populates="user")

    def __repr__(self):
        return f"<User {self.username}>"

# Shared systems table (WMS, OPS, PLAN, ...) owned outside this app; declared
# here only so SQLAlchemy can resolve UserRole.system_id's FK when sorting
# insert order on flush. This app never writes to it.
class System(Base):
    __tablename__ = "systems"
    __table_args__ = {'schema': 'core'}

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)

    def __repr__(self):
        return f"<System {self.name}>"

# User Role model (matches new core.user_roles table structure)
class UserRole(Base):
    __tablename__ = "user_roles"
    __table_args__ = {'schema': 'core'}

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey(_FK_USERS), nullable=False)
    system_id = Column(Integer, ForeignKey("core.systems.id"), nullable=False)
    role = Column(String(50), nullable=False)

    user = relationship("User", back_populates="user_roles")

    def __repr__(self):
        return f"<UserRole user_id={self.user_id} system_id={self.system_id} role={self.role}>"

# Warehouse model (matches provided SQL schema)
class Warehouse(Base):
    __tablename__ = "warehouses"
    __table_args__ = {'schema': 'wms'}

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    type = Column(warehouse_type_enum, nullable=False)

    racks = relationship("WarehouseRack", back_populates="warehouse")

    def __repr__(self):
        return f"<Warehouse {self.name}>"

# Warehouse Rack model (matches provided SQL schema)
class WarehouseRack(Base):
    __tablename__ = "warehouse_racks"
    __table_args__ = {'schema': 'wms'}

    id = Column(Integer, primary_key=True, index=True)
    warehouse_id = Column(Integer, ForeignKey(_FK_WAREHOUSES), nullable=False)
    rack_code = Column(String(50), nullable=False)

    warehouse = relationship("Warehouse", back_populates="racks")
    boxes = relationship("Box", back_populates="rack")
    dyed_fabric_rolls = relationship("DyedFabricRoll", back_populates="rack")
    undyed_fabric_rolls = relationship("UndyedFabricRoll", back_populates="rack")

    def __repr__(self):
        return f"<WarehouseRack {self.rack_code} in warehouse {self.warehouse_id}>"


class Lot(Base):
    __tablename__ = "lots"
    __table_args__ = {"schema": "wms"}

    id = Column(Integer, primary_key=True, index=True)
    client_fabric_code_id = Column(Integer, ForeignKey(_FK_CLIENT_FABRIC_CODES, onupdate="CASCADE", ondelete="RESTRICT"), nullable=False)
    lot_number = Column(String(50), nullable=False)

    client_fabric_code = relationship("ClientFabricCode", back_populates="lots", foreign_keys=[client_fabric_code_id])
    dyed_fabric_rolls = relationship("DyedFabricRoll", back_populates="lot")

    def __repr__(self):
        return f"<Lot {self.lot_number} fabric_code={self.client_fabric_code_id}>"


class DyedFabricRoll(Base):
    __tablename__ = "dyed_fabric_rolls"
    __table_args__ = (
        CheckConstraint("status IN ('in', 'out')", name="ck_dyed_fabric_rolls_status"),
        {"schema": "wms"},
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    client_fabric_code_id = Column(Integer, ForeignKey(_FK_CLIENT_FABRIC_CODES, onupdate="CASCADE", ondelete="RESTRICT"), nullable=False)
    lot_id = Column(Integer, ForeignKey("wms.lots.id", onupdate="CASCADE", ondelete=_ON_DELETE_SET_NULL), nullable=True)
    gsm = Column(NUMERIC(6, 2), nullable=True)
    fabric_width = Column(NUMERIC(6, 2), nullable=True)
    weight = Column(NUMERIC(8, 3), nullable=False)
    length = Column(NUMERIC(8, 2), nullable=True)
    status = Column(String(3), nullable=False, default="in")
    rack_id = Column(Integer, ForeignKey(_FK_RACKS, onupdate="CASCADE", ondelete=_ON_DELETE_SET_NULL), nullable=True)
    defect_points = Column(Integer, nullable=True, default=0)
    quality_grade = Column(String(20), nullable=True)
    received_date = Column(TIMESTAMP, nullable=True)
    issued_date = Column(TIMESTAMP, nullable=True)
    supplier = Column(String(100), nullable=True)
    remarks = Column(Text, nullable=True)
    expected_delivery_item_id = Column(Integer, ForeignKey("wms.expected_delivery_items.id", onupdate="CASCADE", ondelete=_ON_DELETE_SET_NULL), nullable=True)
    ingested_by = Column(Integer, ForeignKey(_FK_USERS), nullable=True)
    # Self-reference for roll lineage (e.g. this roll was split/re-ingested
    # from another dyed roll). Not yet surfaced in the ingestion UI.
    original_roll_id = Column(BigInteger, ForeignKey("wms.dyed_fabric_rolls.id"), nullable=True)

    client_fabric_code = relationship("ClientFabricCode", back_populates="dyed_fabric_rolls", foreign_keys=[client_fabric_code_id])
    lot = relationship("Lot", back_populates="dyed_fabric_rolls", foreign_keys=[lot_id])
    rack = relationship("WarehouseRack", back_populates="dyed_fabric_rolls", foreign_keys=[rack_id])
    receipt_items = relationship("FabricReceiptItem", back_populates="dyed_roll", foreign_keys="FabricReceiptItem.dyed_roll_id")
    ingestor = relationship("User", foreign_keys=[ingested_by])
    original_roll = relationship("DyedFabricRoll", remote_side=[id], foreign_keys=[original_roll_id])

    def __repr__(self):
        return f"<DyedFabricRoll {self.id}>"


class UndyedFabricRoll(Base):
    __tablename__ = "undyed_fabric_rolls"
    __table_args__ = (
        CheckConstraint("status IN ('in', 'out')", name="ck_undyed_fabric_rolls_status"),
        {"schema": "wms"},
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    client_id = Column(Integer, ForeignKey(_FK_CLIENTS, onupdate="CASCADE", ondelete="RESTRICT"), nullable=False)
    material_id = Column(Integer, ForeignKey("core.materials.material_id", onupdate="CASCADE", ondelete="RESTRICT"), nullable=False)
    lot_number = Column(String(50), nullable=True)
    gsm = Column(NUMERIC(6, 2), nullable=True)
    fabric_width = Column(NUMERIC(6, 2), nullable=True)
    weight = Column(NUMERIC(8, 3), nullable=False)
    length = Column(NUMERIC(8, 2), nullable=True)
    status = Column(String(3), nullable=False, default="in")
    rack_id = Column(Integer, ForeignKey(_FK_RACKS, onupdate="CASCADE", ondelete=_ON_DELETE_SET_NULL), nullable=True)
    defect_points = Column(Integer, nullable=True, default=0)
    quality_grade = Column(String(20), nullable=True)
    received_date = Column(TIMESTAMP, nullable=True)
    issued_date = Column(TIMESTAMP, nullable=True)
    supplier = Column(String(100), nullable=True)
    remarks = Column(Text, nullable=True)
    expected_delivery_item_id = Column(Integer, ForeignKey("wms.expected_delivery_items.id", onupdate="CASCADE", ondelete=_ON_DELETE_SET_NULL), nullable=True)
    ingested_by = Column(Integer, ForeignKey(_FK_USERS), nullable=True)

    client = relationship("Client", foreign_keys=[client_id])
    material = relationship("Material", foreign_keys=[material_id])
    rack = relationship("WarehouseRack", back_populates="undyed_fabric_rolls", foreign_keys=[rack_id])
    receipt_items = relationship("FabricReceiptItem", back_populates="undyed_roll", foreign_keys="FabricReceiptItem.undyed_roll_id")
    ingestor = relationship("User", foreign_keys=[ingested_by])

    def __repr__(self):
        return f"<UndyedFabricRoll {self.id}>"


# Box model (matches new core/wms schema)
class Box(Base):
    __tablename__ = "boxes"
    __table_args__ = {'schema': 'wms'}

    id = Column(Integer, primary_key=True, index=True)
    rack_id = Column(Integer, ForeignKey(_FK_RACKS), nullable=True, default=None)
    barcode = Column(String(100), unique=True, nullable=False)
    client_id = Column(Integer, ForeignKey(_FK_CLIENTS), nullable=False)
    weight = Column(NUMERIC(10, 2), nullable=True)
    received = Column(Boolean, nullable=False, default=False)
    carton_number = Column(Integer, nullable=True)
    shipment_id = Column(Integer, nullable=True)

    rack = relationship("WarehouseRack", back_populates="boxes")
    contents = relationship("BoxContent", back_populates="box")
    client = relationship("Client", foreign_keys=[client_id])
    receipt_items = relationship("BoxReceiptItem", back_populates="box", foreign_keys="BoxReceiptItem.box_id")

    def __repr__(self):
        return f"<Box {self.barcode} in rack {self.rack_id}>"

# Box Content model (matches new core/wms schema)
class BoxContent(Base):
    __tablename__ = "box_contents"
    __table_args__ = {'schema': 'wms'}

    id = Column(Integer, primary_key=True, index=True)
    box_id = Column(Integer, ForeignKey("wms.boxes.id"), nullable=False)
    job_order_item_id = Column(Integer, ForeignKey("core.job_order_items.item_id"), nullable=True)
    model_id = Column(Integer, ForeignKey("core.models.model_id"), nullable=True)
    color_id = Column(Integer, ForeignKey(_FK_COLORS), nullable=True)
    size_id = Column(Integer, ForeignKey("core.sizes.size_id"), nullable=True)
    piece_count = Column(Integer, nullable=False)
    weight = Column(NUMERIC(10, 2), nullable=True)

    box = relationship("Box", back_populates="contents")
    job_order_item = relationship("JobOrderItem", back_populates="box_contents", foreign_keys=[job_order_item_id])
    model = relationship("Model", back_populates="box_contents", foreign_keys=[model_id])
    color = relationship("Color", back_populates="box_contents", foreign_keys=[color_id])
    size = relationship("Size", back_populates="box_contents", foreign_keys=[size_id])

    def __repr__(self):
        return f"<BoxContent {self.model_id} {self.color_id} {self.size_id} in box {self.box_id}>"


# Logical Location model (matches provided SQL schema)
class LogicalLocation(Base):
    __tablename__ = "logical_locations"
    __table_args__ = {'schema': 'wms'}

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    contact_name = Column(String(100), nullable=True)
    contact_number = Column(String(20), nullable=True)
    location_type = Column(logical_location_type_enum, nullable=False, default=LogicalLocationType.INTERNAL.value)
    supplier_type = Column(String(100), nullable=True)

    def __repr__(self):
        return f"<LogicalLocation {self.name}>"


# Supplier Receipt — fabric rolls sent to/from a supplier logical location
class SupplierReceipt(Base):
    __tablename__ = "supplier_receipts"
    __table_args__ = {'schema': 'wms'}

    id = Column(Integer, primary_key=True, index=True)
    source_warehouse_id = Column(Integer, ForeignKey(_FK_WAREHOUSES, onupdate="CASCADE", ondelete="RESTRICT"), nullable=False)
    target_logical_location_id = Column(Integer, ForeignKey(_FK_LOG_LOCATIONS, onupdate="CASCADE", ondelete="RESTRICT"), nullable=False)
    closed = Column(Boolean, nullable=False, default=False)
    status = Column(String(20), nullable=False, default='issued')
    issued_by = Column(Integer, ForeignKey(_FK_USERS), nullable=True)
    closed_by = Column(Integer, ForeignKey(_FK_USERS), nullable=True)
    issued_at = Column(TIMESTAMP, default=func.current_timestamp())
    closed_at = Column(TIMESTAMP, nullable=True)
    remarks = Column(Text, nullable=True)

    source_warehouse = relationship("Warehouse", foreign_keys=[source_warehouse_id])
    target_logical_location = relationship("LogicalLocation", foreign_keys=[target_logical_location_id])
    issuer = relationship("User", foreign_keys=[issued_by])
    closer = relationship("User", foreign_keys=[closed_by])
    def __repr__(self):
        return f"<SupplierReceipt {self.id}>"


# Internal Receipt — movement between warehouse and an internal logical location
class InternalReceipt(Base):
    __tablename__ = "internal_receipts"
    __table_args__ = (
        CheckConstraint("status IN ('issued', 'confirmed')", name="ck_internal_receipts_status"),
        {'schema': 'wms'},
    )

    id = Column(Integer, primary_key=True, index=True)
    source_warehouse_id = Column(Integer, ForeignKey(_FK_WAREHOUSES, onupdate="CASCADE", ondelete="RESTRICT"), nullable=False)
    target_logical_location_id = Column(Integer, ForeignKey(_FK_LOG_LOCATIONS, onupdate="CASCADE", ondelete="RESTRICT"), nullable=False)
    closed = Column(Boolean, nullable=False, default=False)
    status = Column(String(20), nullable=False, default='issued')
    issued_by = Column(Integer, ForeignKey(_FK_USERS), nullable=True)
    closed_by = Column(Integer, ForeignKey(_FK_USERS), nullable=True)
    issued_at = Column(TIMESTAMP, default=func.current_timestamp())
    confirmed_by = Column(Integer, ForeignKey(_FK_USERS), nullable=True)

    source_warehouse = relationship("Warehouse", foreign_keys=[source_warehouse_id])
    target_logical_location = relationship("LogicalLocation", foreign_keys=[target_logical_location_id])
    issuer = relationship("User", foreign_keys=[issued_by])
    closer = relationship("User", foreign_keys=[closed_by])
    confirmer = relationship("User", foreign_keys=[confirmed_by])
    def __repr__(self):
        return f"<InternalReceipt {self.id}>"


# External Receipt — items issued to an external named receiver
class ExternalReceipt(Base):
    __tablename__ = "external_receipts"
    __table_args__ = {'schema': 'wms'}

    id = Column(Integer, primary_key=True, index=True)
    source_warehouse_id = Column(Integer, ForeignKey(_FK_WAREHOUSES, onupdate="CASCADE", ondelete="RESTRICT"), nullable=False)
    receiver = Column(String(255), nullable=False)
    closed = Column(Boolean, nullable=False, default=False)
    status = Column(String(20), nullable=False, default='issued')
    issued_by = Column(Integer, ForeignKey(_FK_USERS), nullable=True)
    closed_by = Column(Integer, ForeignKey(_FK_USERS), nullable=True)
    issued_at = Column(TIMESTAMP, default=func.current_timestamp())
    closed_at = Column(TIMESTAMP, nullable=True)

    source_warehouse = relationship("Warehouse", foreign_keys=[source_warehouse_id])
    issuer = relationship("User", foreign_keys=[issued_by])
    closer = relationship("User", foreign_keys=[closed_by])
    def __repr__(self):
        return f"<ExternalReceipt {self.id}>"


# Fabric Receipt Item — dyed or undyed fabric rolls on any receipt type
class FabricReceiptItem(Base):
    __tablename__ = "fabric_receipt_items"
    __table_args__ = (
        CheckConstraint(_CK_ONE_RECEIPT, name="ck_fabric_receipt_items_one_receipt"),
        CheckConstraint(
            "item_type IN ('FabricRoll', 'UndyedFabricRoll')",
            name="ck_fabric_receipt_items_item_type",
        ),
        {'schema': 'wms'},
    )

    id                   = Column(Integer, primary_key=True, index=True)
    supplier_receipt_id  = Column(Integer, ForeignKey(_FK_SUPPLIER_RECEIPTS,  ondelete=_ON_DELETE_CASCADE), nullable=True)
    internal_receipt_id  = Column(Integer, ForeignKey(_FK_INTERNAL_RECEIPTS,  ondelete=_ON_DELETE_CASCADE), nullable=True)
    external_receipt_id  = Column(Integer, ForeignKey(_FK_EXTERNAL_RECEIPTS,  ondelete=_ON_DELETE_CASCADE), nullable=True)
    item_type            = Column(String(20), nullable=False)
    dyed_roll_id         = Column(BigInteger, ForeignKey("wms.dyed_fabric_rolls.id",   ondelete=_ON_DELETE_SET_NULL), nullable=True)
    undyed_roll_id       = Column(BigInteger, ForeignKey("wms.undyed_fabric_rolls.id", ondelete=_ON_DELETE_SET_NULL), nullable=True)

    dyed_roll   = relationship("DyedFabricRoll",   back_populates="receipt_items", foreign_keys=[dyed_roll_id])
    undyed_roll = relationship("UndyedFabricRoll", back_populates="receipt_items", foreign_keys=[undyed_roll_id])

    def __repr__(self):
        return f"<FabricReceiptItem {self.id} {self.item_type}>"


# Box Receipt Item — boxes on any receipt type
class BoxReceiptItem(Base):
    __tablename__ = "box_receipt_items"
    __table_args__ = (
        CheckConstraint(_CK_ONE_RECEIPT, name="ck_box_receipt_items_one_receipt"),
        {'schema': 'wms'},
    )

    id                   = Column(Integer, primary_key=True, index=True)
    supplier_receipt_id  = Column(Integer, ForeignKey(_FK_SUPPLIER_RECEIPTS,  ondelete=_ON_DELETE_CASCADE), nullable=True)
    internal_receipt_id  = Column(Integer, ForeignKey(_FK_INTERNAL_RECEIPTS,  ondelete=_ON_DELETE_CASCADE), nullable=True)
    external_receipt_id  = Column(Integer, ForeignKey(_FK_EXTERNAL_RECEIPTS,  ondelete=_ON_DELETE_CASCADE), nullable=True)
    box_id               = Column(Integer, ForeignKey("wms.boxes.id", ondelete=_ON_DELETE_SET_NULL), nullable=True)

    box = relationship("Box", back_populates="receipt_items", foreign_keys=[box_id])

    def __repr__(self):
        return f"<BoxReceiptItem {self.id}>"


# Accessory Receipt Item — accessory items on any receipt type
class AccessoryReceiptItem(Base):
    __tablename__ = "accessory_receipt_items"
    __table_args__ = (
        CheckConstraint(_CK_ONE_RECEIPT, name="ck_accessory_receipt_items_one_receipt"),
        {'schema': 'wms'},
    )

    id                   = Column(Integer, primary_key=True, index=True)
    supplier_receipt_id  = Column(Integer, ForeignKey(_FK_SUPPLIER_RECEIPTS,  ondelete=_ON_DELETE_CASCADE), nullable=True)
    internal_receipt_id  = Column(Integer, ForeignKey(_FK_INTERNAL_RECEIPTS,  ondelete=_ON_DELETE_CASCADE), nullable=True)
    external_receipt_id  = Column(Integer, ForeignKey(_FK_EXTERNAL_RECEIPTS,  ondelete=_ON_DELETE_CASCADE), nullable=True)
    accessory_item_id    = Column(Integer, nullable=True)

    def __repr__(self):
        return f"<AccessoryReceiptItem {self.id}>"


# Single Transaction — mini receipt for a single item movement
class SingleTransaction(Base):
    __tablename__ = "single_transactions"
    __table_args__ = (
        CheckConstraint("type IN ('external', 'internal')", name="ck_single_transactions_type"),
        CheckConstraint("item_type IN ('Fabric', 'RMG', 'Accessory')", name="ck_single_transactions_item_type"),
        {'schema': 'wms'},
    )

    id = Column(Integer, primary_key=True, index=True)
    type = Column(String(20), nullable=False)
    warehouse_id = Column(Integer, ForeignKey(_FK_WAREHOUSES, onupdate="CASCADE", ondelete="RESTRICT"), nullable=False)
    logical_location_id = Column(Integer, ForeignKey(_FK_LOG_LOCATIONS, onupdate="CASCADE", ondelete=_ON_DELETE_SET_NULL), nullable=True)
    receiver_name = Column(String(255), nullable=True)
    item_type = Column(String(20), nullable=False)
    item_id = Column(Integer, nullable=False)
    remarks = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP, default=func.current_timestamp())

    warehouse = relationship("Warehouse", foreign_keys=[warehouse_id])
    logical_location = relationship("LogicalLocation", foreign_keys=[logical_location_id])

    def __repr__(self):
        return f"<SingleTransaction {self.id} {self.type} {self.item_type}>"


_CK_DELIVERY_ITEM_ONE_TYPE = (
    "CASE WHEN client_fabric_code_id IS NOT NULL THEN 1 ELSE 0 END + "
    "CASE WHEN material_id IS NOT NULL THEN 1 ELSE 0 END = 1"
)

# Undyed lines (material_id set) must also carry the owning client.
_CK_DELIVERY_ITEM_UNDYED_CLIENT = "material_id IS NULL OR client_id IS NOT NULL"

# client_supplier_id is a polymorphic reference (core.clients or
# wms.logical_locations depending on supplier_type), so no DB-level FK is
# possible; both columns must be set together.
_CK_DELIVERY_SUPPLIER_PAIR = "(client_supplier_id IS NULL) = (supplier_type IS NULL)"


class ExpectedDelivery(Base):
    __tablename__ = "expected_deliveries"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'partial', 'received', 'cancelled')",
            name="ck_expected_deliveries_status",
        ),
        CheckConstraint(
            "supplier_type IS NULL OR supplier_type IN ('client', 'logical_location')",
            name="ck_expected_deliveries_supplier_type",
        ),
        CheckConstraint(_CK_DELIVERY_SUPPLIER_PAIR, name="ck_expected_deliveries_supplier_pair"),
        {'schema': 'wms'},
    )

    id = Column(Integer, primary_key=True, index=True)
    client_supplier_id = Column(Integer, nullable=True)
    supplier_type = Column(String(20), nullable=True)
    warehouse_id = Column(Integer, ForeignKey(_FK_WAREHOUSES, onupdate="CASCADE", ondelete="SET NULL"), nullable=True)
    expected_date = Column(DateTime, nullable=True)
    status = Column(String(20), nullable=False, default='pending')
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey(_FK_USERS), nullable=True)
    created_at = Column(TIMESTAMP, default=func.current_timestamp())
    closed_at = Column(TIMESTAMP, nullable=True)
    closed_by = Column(Integer, ForeignKey(_FK_USERS), nullable=True)

    warehouse = relationship("Warehouse", foreign_keys=[warehouse_id])
    creator = relationship("User", foreign_keys=[created_by])
    closer = relationship("User", foreign_keys=[closed_by])
    items = relationship("ExpectedDeliveryItem", back_populates="delivery", cascade=_CASCADE_DELETE)

    def __repr__(self):
        return f"<ExpectedDelivery {self.id} supplier={self.supplier_type}:{self.client_supplier_id}>"


class ExpectedDeliveryItem(Base):
    """One expected line on a delivery.

    Exactly one of client_fabric_code_id (dyed fabric) or material_id (undyed
    fabric) must be set — enforced by the DB check constraint. Undyed lines
    must also set client_id (a fabric code already carries its client).
    """

    __tablename__ = "expected_delivery_items"
    __table_args__ = (
        CheckConstraint(_CK_DELIVERY_ITEM_ONE_TYPE, name="ck_expected_delivery_items_one_type"),
        CheckConstraint(_CK_DELIVERY_ITEM_UNDYED_CLIENT, name="ck_expected_delivery_items_undyed_client"),
        {'schema': 'wms'},
    )

    id = Column(Integer, primary_key=True, index=True)
    delivery_id = Column(Integer, ForeignKey("wms.expected_deliveries.id", ondelete=_ON_DELETE_CASCADE), nullable=False)
    # Dyed fabric: references client_fabric_code (carries client + material + color)
    client_fabric_code_id = Column(Integer, ForeignKey(_FK_CLIENT_FABRIC_CODES, onupdate="CASCADE", ondelete="RESTRICT"), nullable=True)
    # Undyed fabric: references client + material directly
    client_id = Column(Integer, ForeignKey(_FK_CLIENTS, onupdate="CASCADE", ondelete="RESTRICT"), nullable=True)
    material_id = Column(Integer, ForeignKey("core.materials.material_id", onupdate="CASCADE", ondelete="RESTRICT"), nullable=True)
    expected_weight_kg = Column(NUMERIC(10, 2), nullable=True)
    expected_length_m = Column(NUMERIC(10, 2), nullable=True)
    received_weight_kg = Column(NUMERIC(10, 2), nullable=False, default=0)
    received_length_m = Column(NUMERIC(10, 2), nullable=False, default=0)
    notes = Column(Text, nullable=True)

    delivery = relationship("ExpectedDelivery", back_populates="items")
    client_fabric_code = relationship("ClientFabricCode", foreign_keys=[client_fabric_code_id])
    client = relationship("Client", foreign_keys=[client_id])
    material = relationship("Material", foreign_keys=[material_id])

    def __repr__(self):
        return f"<ExpectedDeliveryItem {self.id} delivery={self.delivery_id}>"


# Backward compatibility alias; canonical definition lives in backend.schemas.
if TYPE_CHECKING:
    from .schemas import TokenPayload as TokenPayload
else:
    from .schemas import TokenPayload  # type: ignore
