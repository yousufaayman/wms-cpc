from fastapi import APIRouter
from .endpoints import (
    auth,
    warehouses,
    warehouse_racks,
    boxes,
    box_contents,
    vendor_receipts,
    internal_receipts,
    external_receipts,
    logical_locations,
    single_transactions,
    user_roles,
    materials,
    clients,
    colors,
    client_fabric_codes,
    lots,
    fabric_rolls,
    undyed_fabric_rolls,
    receipt_items,
    expected_deliveries,
    job_order_material_requests,
    material_request_fulfillments,
)

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(warehouses.router, prefix="/warehouses", tags=["warehouses"])
api_router.include_router(warehouse_racks.router, prefix="/warehouse-racks", tags=["warehouse-racks"])
api_router.include_router(boxes.router, prefix="/boxes", tags=["boxes"])
api_router.include_router(box_contents.router, prefix="/box-contents", tags=["box-contents"])
api_router.include_router(vendor_receipts.router, prefix="/supplier-receipts", tags=["supplier-receipts"])
api_router.include_router(internal_receipts.router, prefix="/internal-receipts", tags=["internal-receipts"])
api_router.include_router(external_receipts.router, prefix="/external-receipts", tags=["external-receipts"])
api_router.include_router(logical_locations.router, prefix="/logical-locations", tags=["logical-locations"])
api_router.include_router(single_transactions.router, prefix="/single-transactions", tags=["single-transactions"])
api_router.include_router(user_roles.router, prefix="/user-roles", tags=["user-roles"])
api_router.include_router(materials.router, prefix="/materials", tags=["materials"])
api_router.include_router(clients.router, prefix="/clients", tags=["clients"])
api_router.include_router(colors.router, prefix="/colors", tags=["colors"])
api_router.include_router(client_fabric_codes.router, prefix="/client-fabric-codes", tags=["client-fabric-codes"])
api_router.include_router(lots.router, prefix="/lots", tags=["lots"])
api_router.include_router(fabric_rolls.router, prefix="/dyed-fabric-rolls", tags=["dyed-fabric-rolls"])
api_router.include_router(undyed_fabric_rolls.router, prefix="/undyed-fabric-rolls", tags=["undyed-fabric-rolls"])
api_router.include_router(receipt_items.router, prefix="/receipts", tags=["receipt-items"])
api_router.include_router(expected_deliveries.router, prefix="/expected-deliveries", tags=["expected-deliveries"])
api_router.include_router(job_order_material_requests.router, prefix="/job-order-material-requests", tags=["job-order-material-requests"])
api_router.include_router(material_request_fulfillments.router, prefix="/material-request-fulfillments", tags=["material-request-fulfillments"])
