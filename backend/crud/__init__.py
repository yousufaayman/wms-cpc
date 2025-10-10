# Import all CRUD modules
from . import users
from . import warehouses
from . import warehouse_racks

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
