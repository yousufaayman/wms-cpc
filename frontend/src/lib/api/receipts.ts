// Legacy receipts module — superseded by vendor-receipts, internal-receipts, external-receipts.
// Re-exports the new APIs under the old names so any stale imports don't break at compile time.
export { vendorReceiptApi as receiptApi } from './vendor-receipts';
export type { SupplierReceipt as Receipt, SupplierReceiptCreate as ReceiptCreate, SupplierReceiptUpdate as ReceiptUpdate, SupplierReceiptFilters as ReceiptFilters } from './vendor-receipts';

// Keep old type aliases for backward compatibility
export type ReceiptType = 'vendor' | 'internal' | 'external';
export type ReceiptStatus = 'issued' | 'confirmed';
