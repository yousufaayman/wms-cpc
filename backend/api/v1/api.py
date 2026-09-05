from fastapi import APIRouter, Depends

from backend.core.deps import get_current_wt_or_admin

from .endpoints import (
    analytics,
    auth,
    users,
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
    material_requests,
    material_request_fulfillments,
)

api_router = APIRouter()

# Every business router requires a logged-in user holding one of the WMS
# roles (admin, gen_ops, W_Manager, W_Worker, Viewer) for system_id=1.
# Endpoints with stricter rules (reopen receipts/deliveries, user management)
# layer their own admin checks on top. Only /auth stays open so users can log in.
_WT_OR_ADMIN = [Depends(get_current_wt_or_admin)]

api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"], dependencies=_WT_OR_ADMIN)
api_router.include_router(warehouses.router, prefix="/warehouses", tags=["warehouses"], dependencies=_WT_OR_ADMIN)
api_router.include_router(warehouse_racks.router, prefix="/warehouse-racks", tags=["warehouse-racks"], dependencies=_WT_OR_ADMIN)
api_router.include_router(boxes.router, prefix="/boxes", tags=["boxes"], dependencies=_WT_OR_ADMIN)
api_router.include_router(box_contents.router, prefix="/box-contents", tags=["box-contents"], dependencies=_WT_OR_ADMIN)
api_router.include_router(vendor_receipts.router, prefix="/supplier-receipts", tags=["supplier-receipts"], dependencies=_WT_OR_ADMIN)
api_router.include_router(internal_receipts.router, prefix="/internal-receipts", tags=["internal-receipts"], dependencies=_WT_OR_ADMIN)
api_router.include_router(external_receipts.router, prefix="/external-receipts", tags=["external-receipts"], dependencies=_WT_OR_ADMIN)
api_router.include_router(logical_locations.router, prefix="/logical-locations", tags=["logical-locations"], dependencies=_WT_OR_ADMIN)
api_router.include_router(single_transactions.router, prefix="/single-transactions", tags=["single-transactions"], dependencies=_WT_OR_ADMIN)
api_router.include_router(user_roles.router, prefix="/user-roles", tags=["user-roles"], dependencies=_WT_OR_ADMIN)
api_router.include_router(materials.router, prefix="/materials", tags=["materials"], dependencies=_WT_OR_ADMIN)
api_router.include_router(clients.router, prefix="/clients", tags=["clients"], dependencies=_WT_OR_ADMIN)
api_router.include_router(colors.router, prefix="/colors", tags=["colors"], dependencies=_WT_OR_ADMIN)
api_router.include_router(client_fabric_codes.router, prefix="/client-fabric-codes", tags=["client-fabric-codes"], dependencies=_WT_OR_ADMIN)
api_router.include_router(lots.router, prefix="/lots", tags=["lots"], dependencies=_WT_OR_ADMIN)
api_router.include_router(fabric_rolls.router, prefix="/dyed-fabric-rolls", tags=["dyed-fabric-rolls"], dependencies=_WT_OR_ADMIN)
api_router.include_router(undyed_fabric_rolls.router, prefix="/undyed-fabric-rolls", tags=["undyed-fabric-rolls"], dependencies=_WT_OR_ADMIN)
api_router.include_router(receipt_items.router, prefix="/receipts", tags=["receipt-items"], dependencies=_WT_OR_ADMIN)
api_router.include_router(expected_deliveries.router, prefix="/expected-deliveries", tags=["expected-deliveries"], dependencies=_WT_OR_ADMIN)
api_router.include_router(material_requests.router, prefix="/job-order-material-requests", tags=["job-order-material-requests"], dependencies=_WT_OR_ADMIN)
api_router.include_router(material_request_fulfillments.router, prefix="/material-request-fulfillments", tags=["material-request-fulfillments"], dependencies=_WT_OR_ADMIN)
api_router.include_router(analytics.router, prefix="/analytics", tags=["analytics"], dependencies=_WT_OR_ADMIN)
