# Import all CRUD modules
from . import users
from . import warehouses
from . import warehouse_racks
from . import boxes
from . import box_contents
from . import vendor_receipts
from . import internal_receipts
from . import external_receipts
from . import logical_locations
from . import single_transactions
from . import user_roles
from . import materials
from . import clients
from . import colors
from . import client_fabric_codes
from . import lots
from . import fabric_rolls
from . import undyed_fabric_rolls
from . import receipt_items
from . import material_request_fulfillments

# Export commonly used functions for backward compatibility
from .users import (
    get_user,
    get_user_by_username,
    get_users,
    create_user,
    update_user,
    delete_user,
)

from .warehouses import (
    get_warehouse,
    get_warehouse_by_name,
    get_warehouses,
    create_warehouse,
    update_warehouse,
    delete_warehouse,
)

from .warehouse_racks import (
    get_warehouse_rack,
    get_warehouse_rack_by_code,
    get_warehouse_racks,
    get_warehouse_racks_by_warehouse,
    create_warehouse_rack,
    update_warehouse_rack,
    delete_warehouse_rack,
)

__all__ = [
    # Users
    "get_user",
    "get_user_by_username",
    "get_users",
    "create_user",
    "update_user",
    "delete_user",

    # Warehouses
    "get_warehouse",
    "get_warehouse_by_name",
    "get_warehouses",
    "create_warehouse",
    "update_warehouse",
    "delete_warehouse",

    # Warehouse Racks
    "get_warehouse_rack",
    "get_warehouse_rack_by_code",
    "get_warehouse_racks",
    "get_warehouse_racks_by_warehouse",
    "create_warehouse_rack",
    "update_warehouse_rack",
    "delete_warehouse_rack",
]
