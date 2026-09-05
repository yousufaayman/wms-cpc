# Fabric Roll Ingestion & Expected Deliveries

This document explains, in detail, how fabric rolls are ingested into the WMS in the
current codebase, how the Expected Deliveries feature works, and how (or whether)
the two are linked today.

Everything below was derived directly from the code on the `development` branch:

| Layer | Files |
|---|---|
| DB models | `backend/models.py` |
| Pydantic schemas | `backend/schemas.py` |
| CRUD | `backend/crud/fabric_rolls.py`, `backend/crud/undyed_fabric_rolls.py`, `backend/crud/client_fabric_codes.py`, `backend/crud/lots.py`, `backend/crud/expected_deliveries.py` |
| API endpoints | `backend/api/v1/endpoints/fabric_rolls.py`, `.../undyed_fabric_rolls.py`, `.../expected_deliveries.py`, router wiring in `backend/api/v1/api.py` |
| Frontend pages | `frontend/src/pages/FabricRolls.tsx` (dyed), `UndyedFabricRolls.tsx`, `ExpectedDeliveries.tsx`, `ExpectedDeliveryDetail.tsx` |
| Frontend API clients | `frontend/src/lib/api/fabric-rolls.ts`, `undyed-fabric-rolls.ts`, `expected-deliveries.ts` |

---

## Part 1 — Fabric Roll Ingestion

### 1.1 The two roll types and their identity models

The system tracks two physically and logically distinct kinds of fabric rolls, each
with its own table, endpoint, and ingestion page:

**Dyed rolls** (`wms.dyed_fabric_rolls`) are identified by a **Client Fabric Code**
(`core.client_fabric_codes`), which is the canonical identity for dyed fabric — a
unique-by-convention combination of:

- `client_id` → `core.clients`
- `material_id` → `core.materials`
- `color_id` → `core.colors`
- optional free-text `fabric_code` label

A dyed roll therefore does not carry client/material/color directly; it carries a
single FK `client_fabric_code_id`, and the trio is resolved through it. Dyed rolls
can additionally belong to a **Lot** (`wms.lots`), which is itself scoped to a
client fabric code (`lot_number` + `client_fabric_code_id`, deduplicated in CRUD,
not by a DB unique constraint).

**Undyed rolls** (`wms.undyed_fabric_rolls`) have no color and no fabric-code
concept. They reference `client_id` and `material_id` **directly**, and their
`lot_number` is a **free-text string column** on the roll itself — undyed rolls do
*not* use the `wms.lots` table at all.

Shared columns on both roll tables:

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | The roll's barcode-able identity |
| `gsm` | NUMERIC(6,2) | nullable |
| `fabric_width` | NUMERIC(6,2) | nullable, cm |
| `weight` | NUMERIC(8,3) | **required** — the only mandatory measurement |
| `length` | NUMERIC(8,2) | nullable, always stored in meters |
| `status` | VARCHAR(3) | `'in'` or `'out'`, DB CHECK constraint, defaults `'in'` |
| `rack_id` | FK → `wms.warehouse_racks` | nullable, ON DELETE SET NULL |
| `defect_points`, `quality_grade` | | nullable QC fields (not captured by the ingestion UI) |
| `received_date`, `issued_date` | TIMESTAMP | set by the client at ingestion / issue |
| `supplier` | VARCHAR(100) | **denormalized free-text name** — see §1.4 |
| `remarks` | TEXT | nullable |

Tables are created by SQLAlchemy `Base.metadata.create_all(bind=engine)` in
`backend/main.py` at startup (no migration framework; enum types are pre-created by
`backend/startup/bootstrap.py`).

### 1.2 Dyed roll ingestion — the 3-step flow (`FabricRolls.tsx`)

The ingestion page is a session-oriented, scan-gun-friendly wizard designed so that
a warehouse operator sets shared batch context **once**, then rapidly enters many
rolls that differ only in weight/length.

**Step 1 — Identify the fabric.** The operator picks Client, Material, and Color
from comboboxes. The moment all three are set, a `useEffect` fires
`POST /api/v1/client-fabric-codes/get-or-create`
(`crud.client_fabric_codes.get_or_create_client_fabric_code`): it looks up the
exact (client, material, color) combination and returns the existing row, or
inserts a new one with `fabric_code = NULL`. This means **fabric codes are created
implicitly, on demand, during ingestion** — the operator never types a code.
Changing any of the three selections resets the rest of the wizard (lots, lock
state, session rolls).

The operator also selects a **Supplier**, from one of two sources:
- a **Client** (fabric owned/sent by a client), or
- a **Logical Location** (`wms.logical_locations`, e.g. a dye house).

**Step 2 — Lock batch details.** Values that are constant for the physical batch
being received:

- **Lot** — three modes: *No lot* (`lot_id = NULL`), *Existing* (pick from
  `GET /api/v1/lots?client_fabric_code_id=…`), or *New*
  (`POST /api/v1/lots/get-or-create` with the fabric code + typed lot number —
  again a get-or-create, so re-typing an existing number reuses the lot).
- **Fabric width (cm)** and **GSM** — optional, applied to every roll in the session.
- **Length unit** — `m` or `yd`. This is purely a UI convenience: if `yd` is
  chosen, each entered length is converted client-side (`× 0.9144`) and **always
  persisted in meters**.
- **Rack** — an optional put-away location, resolved by scanning/typing either a
  rack code (`GET /api/v1/warehouse-racks` code search, optionally scoped by the
  `?warehouse=` URL query param) or a barcode of the form `<id>*R` which resolves
  the rack by primary key. All session rolls get this `rack_id`.
- **Printer** — a Zebra printer discovered via BrowserPrint
  (`BrowserPrint.getLocalDevices`). *Note: selecting a printer currently has no
  effect on this page — no roll label is printed after creation. The ZPL printing
  path (`lib/zpl/zebraPrinterService`) is only wired up for rack labels in
  `ManageWarehouseRacks.tsx` / `PrintDialog.tsx`.*

Pressing **Lock Details** freezes Steps 1–2 into a `lockedDetails` snapshot and
reveals Step 3. Locking is when a *New* lot actually gets created.

**Step 3 — Add rolls.** For each physical roll the operator enters **weight (kg,
required)** and optionally length, then presses Enter/Add. Each add issues:

```
POST /api/v1/dyed-fabric-rolls/
{
  client_fabric_code_id: <from step 1>,
  lot_id:        <locked, may be omitted>,
  gsm:           <locked, optional>,
  fabric_width:  <locked, optional>,
  weight:        <per-roll>,
  length:        <per-roll, meters>,
  supplier:      "<resolved supplier NAME string>",
  received_date: <browser 'now' ISO timestamp>,
  rack_id:       <locked, optional>
}
```

The backend (`crud.fabric_rolls.create_fabric_roll`) is a plain
`INSERT` + commit — `DyedFabricRoll(**roll.model_dump())`. `status` defaults to
`'in'` via the Pydantic schema (`DyedFabricRollCreate`), which also validates
`weight/length/gsm/width ≥ 0` and `status ∈ {in, out}`. **Each roll is its own
INSERT and its own transaction** — a "session" of 30 rolls is 30 independent POSTs;
there is no batch/receiving document created, and no server-side grouping of the
session.

The created roll (with its DB-assigned `id`) is appended to a client-side
"session rolls" table for operator confirmation. This list lives only in React
state and vanishes on reset/navigation.

### 1.3 Undyed roll ingestion (`UndyedFabricRolls.tsx`)

Structurally identical 3-step wizard with these differences:

- Step 1 selects only **Client + Material** (no color, so no ClientFabricCode
  get-or-create round-trip).
- The lot is a plain **free-text lot number** stored on the roll
  (`lot_number` column); no `wms.lots` row is created or referenced.
- POST goes to `/api/v1/undyed-fabric-rolls/` with `client_id` + `material_id`
  instead of `client_fabric_code_id`. Same supplier/rack/unit-conversion handling.

### 1.4 Key technical characteristics of ingestion

1. **Supplier is a denormalized string.** Although the UI forces the operator to
   pick a real Client or Logical Location, only the resolved **name** is stored in
   the roll's `supplier` VARCHAR column. There is no FK, so renaming a client or
   location silently orphans historical supplier attribution, and any future
   matching against suppliers must be string-based.
2. **No receiving document is produced.** Ingestion creates inventory rows only.
   The receipt system (`wms.supplier_receipts` / `internal_receipts` /
   `external_receipts` + `wms.fabric_receipt_items`) is exclusively an
   **outbound/issuing** mechanism in the current code — `fabric_receipt_items`
   links rolls to receipts when they are issued out, not when they arrive.
3. **Inventory is derived, not maintained.** Current stock views
   (`GET /dyed-fabric-rolls/inventory`, `GET /undyed-fabric-rolls/inventory`)
   query all rolls with `status = 'in'` and aggregate them in Python:
   client → material → fabric code (dyed only) → (lot, supplier) group → rolls,
   with weight/length/count subtotals computed at each level
   (`crud.fabric_rolls.get_fabric_inventory`).
4. **Endpoints are unauthenticated.** The roll and delivery routers depend only on
   `get_db`; there is no user/token dependency. Route protection exists only in
   the frontend (`ProtectedRoute`).
5. **Minor type gap:** the frontend `FabricRollCreate` interface
   (`lib/api/fabric-rolls.ts`) does not declare `rack_id`, although
   `FabricRolls.tsx` sends it and the backend `DyedFabricRollCreate` schema
   accepts it. The undyed create type *does* declare `rack_id`.

---

## Part 2 — Expected Deliveries

### 2.1 Purpose and data model

Expected Deliveries are **advance shipment notices**: a record that a supplier is
going to deliver certain fabric, what is expected (weight/length per line), and —
in principle — what was actually received against each line.

**`wms.expected_deliveries`** (header):

| Column | Notes |
|---|---|
| `id` | PK |
| `supplier` | VARCHAR(200), **required, free text** — typed by the user, not a FK |
| `warehouse_id` | FK → `wms.warehouses`, nullable, ON DELETE SET NULL |
| `expected_date` | nullable DATETIME |
| `status` | `'pending' \| 'partial' \| 'received' \| 'cancelled'` (DB CHECK), defaults `'pending'` |
| `notes` | TEXT |
| `created_by` / `created_at` | user FK (passed as a `?created_by=` query param from the UI, not derived from auth) / server timestamp |
| `closed_at` / `closed_by` | see status handling below |

**`wms.expected_delivery_items`** (lines) — one row per expected fabric line:

| Column | Notes |
|---|---|
| `delivery_id` | FK → header, ON DELETE CASCADE (plus ORM `delete-orphan` cascade) |
| `client_fabric_code_id` | FK → `core.client_fabric_codes` — the **dyed** path |
| `material_id` | FK → `core.materials` — the **undyed** path |
| `lot_reference` | VARCHAR(100), free text (not an FK to `wms.lots`) |
| `expected_weight_kg` / `expected_length_m` | NUMERIC(10,2), nullable |
| `received_weight_kg` / `received_length_m` | NUMERIC(10,2), NOT NULL, **default 0** |
| `notes` | TEXT |

The line type is mutually exclusive by design: a DB CHECK constraint
(`ck_expected_delivery_items_one_type`) requires **exactly one** of
`client_fabric_code_id` or `material_id` to be non-null, and the Pydantic schema
duplicates this with a `@model_validator` ("Exactly one of client_fabric_code_id
(dyed) or material_id (undyed) must be set"). This deliberately mirrors the two
roll identity models from Part 1 — a dyed expectation is expressed in the same
vocabulary as a dyed roll (fabric code), and an undyed expectation in the same
vocabulary as an undyed roll (material).

### 2.2 API surface (`/api/v1/expected-deliveries`)

| Method & path | Behavior |
|---|---|
| `GET /` | List, filterable by `warehouse_id` and `status`, newest first, paginated |
| `GET /{id}` | Header + items eagerly loaded (`selectinload` items, `joinedload` material & fabric code) |
| `POST /?created_by=` | Create header; status forced to `'pending'`; items start empty |
| `PUT /{id}` | Partial update (supplier, warehouse, date, notes, **status**). If the new status is `received` or `cancelled`, `closed_at` is set to `current_timestamp` |
| `DELETE /{id}` | Hard delete; items cascade |
| `POST /{id}/items` | Add a line; `received_weight_kg`/`received_length_m` forced to 0 |
| `PUT /items/{item_id}` | Partial update of a line — **this is the only backend way to record received quantities** (`received_weight_kg`, `received_length_m` are writable here) |
| `DELETE /items/{item_id}` | Delete a line |

Noteworthy backend quirks:

- `closed_by` is **never set** anywhere.
- Reopening (`status → 'pending'` on a closed delivery) does **not** clear
  `closed_at`.
- Status is entirely caller-controlled; the backend never computes `partial` or
  `received` from item quantities.

### 2.3 Frontend flow

**List page (`ExpectedDeliveries.tsx`, route `/expected-deliveries?warehouse=N`)**
Lists deliveries for the warehouse (from the URL query param), client-side filters
by status and supplier substring. "New Expected Delivery" opens a dialog with
supplier (free text), expected date, and notes; on create it navigates to the
detail page.

**Detail page (`ExpectedDeliveryDetail.tsx`)**
- Shows header info and a **manually driven status control**: *Mark as Partial*,
  *Mark as Received*, *Mark as Cancelled*, and *Reopen* — each simply issues
  `PUT /{id}` with the new status.
- Items table with an add dialog: pick *Dyed* (select an existing ClientFabricCode
  from a dropdown of all CFCs) or *Undyed* (select a Material), plus lot
  reference, expected weight/length, notes.
- Each row shows **variance cells** comparing `received_*` vs `expected_*`
  (on-target / over / under with a ±0.001 tolerance).
- Editing is disabled once status is `received` or `cancelled` (`canEdit`).

Crucially: **the detail page never writes `received_weight_kg` /
`received_length_m`.** The variance columns therefore always compare against the
default 0 unless someone updates an item through the raw API. The received-fields
plumbing exists end-to-end (columns, schema, PUT endpoint) but no UI feeds it.

---

## Part 3 — How ingestion and expected deliveries are linked

### 3.1 Current state: **they are not linked at all**

This is the most important fact and it is unambiguous in the code:

- A grep for `ExpectedDelivery` / delivery references across the backend hits only
  the feature's own five files (`models.py`, `schemas.py`,
  `crud/expected_deliveries.py`, `endpoints/expected_deliveries.py`,
  `api.py` router registration). **Neither `crud/fabric_rolls.py` nor
  `crud/undyed_fabric_rolls.py` touches expected deliveries**, and the roll
  create endpoints accept no delivery/item reference.
- Neither roll table has a delivery FK, and `expected_delivery_items` has no
  roll FK. There is no join table.
- The ingestion pages (`FabricRolls.tsx`, `UndyedFabricRolls.tsx`) never import or
  call `expectedDeliveryApi`; they have no awareness that a delivery might be
  pending.
- Consequently, today the workflow is two disconnected manual tracks:
  1. Rolls are ingested and stock increases — no delivery is consulted or updated.
  2. Expected deliveries are bookkeeping documents whose `received_*` values stay
     at 0 and whose status a user flips by hand ("Mark as Received") after
     eyeballing that the goods arrived.

The only "links" that exist are **shared vocabulary**, i.e. the conditions that
would make reconciliation possible:

| Concept | On the roll | On the delivery item | Joinable? |
|---|---|---|---|
| Dyed identity | `client_fabric_code_id` (FK) | `client_fabric_code_id` (FK) | ✅ exact FK match possible |
| Undyed identity | `client_id` + `material_id` (FKs) | `material_id` (FK only — **no client**) | ⚠️ partial (delivery line doesn't know the client) |
| Lot | dyed: `lot_id` FK / undyed: `lot_number` text | `lot_reference` free text | ⚠️ string comparison only |
| Supplier | `supplier` free-text name | `supplier` free-text name | ⚠️ string comparison only |
| Warehouse | only implicitly via `rack_id → rack.warehouse_id` | `warehouse_id` (nullable) | ⚠️ indirect |
| Quantities | `weight` (kg), `length` (m) | `expected_/received_ weight_kg`, `length_m` | ✅ same units |

### 3.2 Designed-but-unimplemented linkage (frontend evidence)

`frontend/src/lib/api/expected-deliveries.ts` reveals the intended reconciliation
design — it declares two API methods **whose backend routes do not exist**, and
several fields the backend model doesn't have:

```ts
receiveItem: (itemId, weight_kg, length_m, roll_id?) =>
  PATCH /expected-deliveries/items/{itemId}/receive   // ❌ no such backend route

reconcileRoll: (deliveryId, body: ReconcileRollRequest) =>
  POST /expected-deliveries/{deliveryId}/reconcile-roll // ❌ no such backend route
```

`ReconcileRollRequest` carries: `roll_id`, `roll_type: 'dyed' | 'undyed'`,
`weight_kg`, `length_m`, `client_fabric_code_id`, `lot_id`, `material_id`,
`lot_reference`, `expected_gsm`, `expected_weight_kg/length_m`; the response type
`ReconcileRollResult { item, created }` implies the backend was meant to **match
the roll to an existing delivery item or create one ad-hoc**, and accumulate the
roll's weight/length into the item's `received_*` totals.

The TypeScript interfaces also anticipate backend columns that don't exist yet:

- `ExpectedDelivery.supplier_client_id` / `supplier_location_id` (+ nested
  objects) — i.e. replacing the free-text supplier with the same
  client-vs-logical-location choice the ingestion pages use.
- `ExpectedDeliveryItem.lot_id` + nested `lot` — a real FK to `wms.lots` instead
  of the `lot_reference` string.
- `expected_gsm` on items.
- `fabric_code_planned: boolean` — flagging whether the fabric code existed when
  the delivery was planned or was "created ad-hoc during processing" (per the
  inline comment), which dovetails with ingestion's implicit
  get-or-create of fabric codes.

**Nothing calls these functions yet** — no page references `receiveItem` or
`reconcileRoll` — so they are forward-declarations of the intended flow, which
evidently is:

> During roll ingestion, the operator (or the system automatically, by matching
> supplier + fabric code/material + lot) selects an open expected delivery; each
> created roll is reconciled against it — matched to an existing line or a new
> ad-hoc line — its weight/length added to `received_*`; delivery status can then
> progress `pending → partial → received` based on actual data instead of manual
> button presses.

### 3.3 Summary of gaps to close if/when linking is implemented

1. Backend routes `PATCH /expected-deliveries/items/{id}/receive` and
   `POST /expected-deliveries/{id}/reconcile-roll` (transactional: create roll ↔
   update item together, or reconcile-after-create).
2. Schema additions: `supplier_client_id`/`supplier_location_id` on deliveries,
   `lot_id`, `expected_gsm`, `fabric_code_planned` on items; ideally a roll↔item
   link table (or `expected_delivery_item_id` on rolls) for auditability, since
   accumulating totals alone loses which rolls satisfied which line.
3. Automatic status derivation (`partial`/`received`) from item received totals,
   plus setting `closed_by` and clearing `closed_at` on reopen.
4. Ingestion UI: surface open deliveries for the selected supplier/warehouse in
   Step 1–2 and reconcile on each Add Roll (all new UI strings must go through
   the i18n framework with en/ar translations).
5. Replace the denormalized `supplier` string on rolls (or at least also store the
   FK) so matching does not depend on name equality.
