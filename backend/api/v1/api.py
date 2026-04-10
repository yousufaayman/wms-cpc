from fastapi import APIRouter
from .endpoints import (
    auth, 
    warehouses, 
    warehouse_racks, 
    boxes, 
    box_contents, 
    receipts, 
    receipt_items, 
    logical_locations, 
    single_transactions,
    user_roles
)

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(warehouses.router, prefix="/warehouses", tags=["warehouses"])
api_router.include_router(warehouse_racks.router, prefix="/warehouse-racks", tags=["warehouse-racks"])
api_router.include_router(boxes.router, prefix="/boxes", tags=["boxes"])
api_router.include_router(box_contents.router, prefix="/box-contents", tags=["box-contents"])
api_router.include_router(receipts.router, prefix="/receipts", tags=["receipts"])
api_router.include_router(receipt_items.router, prefix="/receipt-items", tags=["receipt-items"])
api_router.include_router(logical_locations.router, prefix="/logical-locations", tags=["logical-locations"])
api_router.include_router(single_transactions.router, prefix="/single-transactions", tags=["single-transactions"])
api_router.include_router(user_roles.router, prefix="/user-roles", tags=["user-roles"]) 