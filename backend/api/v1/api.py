from fastapi import APIRouter
from .endpoints import auth, warehouses, warehouse_racks

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(warehouses.router, prefix="/warehouses", tags=["warehouses"])
api_router.include_router(warehouse_racks.router, prefix="/warehouse-racks", tags=["warehouse-racks"]) 