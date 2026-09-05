// Export API client
export { api, ApiClient, type HttpMethod, type ApiClientOptions } from './client';

// Export warehouse types and API
export {
  warehouseApi,
  type Warehouse,
  type WarehouseType,
  type WarehouseCreate,
  type WarehouseUpdate
} from './warehouses';

// Export warehouse rack types and API
export {
  warehouseRackApi,
  type WarehouseRack,
  type WarehouseRackCreate,
  type WarehouseRackUpdate,
  type RackContents,
  type RackDyedGroup,
  type RackUndyedGroup,
} from './warehouse-racks';

// Export box types and API
export {
  boxApi,
  type Box,
  type BoxCreate,
  type BoxUpdate,
  type BoxFilters,
  type BoxAggregation,
  type BoxAggregationFilters
} from './boxes';

// Export box contents types and API
export {
  boxContentApi,
  type BoxContent,
  type BoxContentCreate,
  type BoxContentUpdate
} from './box-contents';

// Export logical location types and API
export {
  logicalLocationApi,
  type LogicalLocation,
  type LogicalLocationType,
  type LogicalLocationCreate,
  type LogicalLocationUpdate,
  type LogicalLocationFilters
} from './logical-locations';

// Export supplier receipt types and API
export {
  supplierReceiptApi,
  type SupplierReceipt,
  type SupplierReceiptCreate,
  type SupplierReceiptUpdate,
  type SupplierReceiptFilters,
  // backward-compat aliases
  vendorReceiptApi,
  type VendorReceipt,
} from './vendor-receipts';

// Export internal receipt types and API
export {
  internalReceiptApi,
  type InternalReceipt,
  type InternalReceiptCreate,
  type InternalReceiptUpdate,
  type InternalReceiptStatus,
  type InternalReceiptFilters,
} from './internal-receipts';

// Export external receipt types and API
export {
  externalReceiptApi,
  type ExternalReceipt,
  type ExternalReceiptCreate,
  type ExternalReceiptUpdate,
  type ExternalReceiptFilters,
} from './external-receipts';

// Export material types and API
export { materialApi, type Material } from './materials';

// Export client types and API
export { clientApi, type Client } from './clients';

// Export color types and API
export { colorApi, type Color } from './colors';

// Export client fabric code types and API
export {
  clientFabricCodeApi,
  type ClientFabricCode,
  type GetOrCreateCFCRequest,
  type FabricCodeLookupResult,
} from './client-fabric-codes';

// Export lot types and API
export { lotApi, type Lot, type LotCreate } from './lots';

// Export dyed fabric roll types and API
export {
  fabricRollApi,
  type FabricRoll,
  type FabricRollCreate,
  type FabricRollDetail,
  type ClientInventoryGroup,
  type MaterialInventoryGroup,
  type FabricCodeInventory,
  type InventoryLotGroup,
  type InventoryRollDetail,
  type RollFlowEntryBase,
  type DyedRollFlowEntry,
} from './fabric-rolls';

// Export receipt item types and APIs
export {
  fabricReceiptItemApi,
  type FabricReceiptItem,
  type FabricReceiptItemCreate,
  boxReceiptItemApi,
  type BoxReceiptItem,
  type BoxReceiptItemCreate,
  accessoryReceiptItemApi,
  type AccessoryReceiptItem,
  type AccessoryReceiptItemCreate,
  type ReceiptKind,
} from './receipt-items';

// Export undyed fabric roll types and API
export {
  undyedFabricRollApi,
  type UndyedFabricRoll,
  type UndyedFabricRollCreate,
  type UndyedFabricRollDetail,
  type UndyedClientInventoryGroup,
  type UndyedMaterialInventory,
  type UndyedInventoryLotGroup,
  type UndyedInventoryRollDetail,
  type UndyedRollFlowEntry,
} from './undyed-fabric-rolls';

// Export material request types and API
export {
  materialRequestApi,
  type MaterialRequest,
  type MaterialRequestCreate,
  type MaterialRequestFilters,
  type MaterialRequestFabricCode,
  type MaterialRequestJobOrder,
  type MaterialRequestMetrics,
  type RequestBulkMetrics,
} from './material-requests';

// Export material request fulfillment types and API
export {
  materialRequestFulfillmentApi,
  type MaterialRequestFulfillment,
  type MaterialRequestFulfillmentCreate,
  type MaterialRequestFulfillmentUpdate,
  type MaterialRequestFulfillmentFilters,
  type MRFNestedReceipt,
} from './material-request-fulfillments';

// Export analytics types and API
export {
  analyticsApi,
  type AccountFlow,
  type AccountFlowRoll,
  type FlowAccount,
  type FlowAccountType,
  type ExportLang,
} from './analytics';

// Export user types and API
export { userApi, type User, type UserCreate } from './users';

// Export user role types and API
export {
  userRoleApi,
  WMS_SYSTEM_ID,
  type WmsRole,
  type UserRole,
  type UserRoleCreate,
} from './user-roles';

// Export expected delivery types and API
export {
  expectedDeliveryApi,
  type ExpectedDelivery,
  type ExpectedDeliveryCreate,
  type ExpectedDeliveryUpdate,
  type ExpectedDeliveryItem,
  type ExpectedDeliveryItemCreate,
  type ExpectedDeliveryItemUpdate,
  type ExpectedDeliveryFilters,
  type ExpectedDeliveryStatus,
  type SupplierType,
} from './expected-deliveries';
