import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Search, Loader2, Eye, Calendar, Plus, Package } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { useTranslation } from "@/hooks/useTranslation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import LanguageToggle from "@/components/LanguageToggle";
import {
  supplierReceiptApi, type SupplierReceipt,
  internalReceiptApi, type InternalReceipt,
  externalReceiptApi, type ExternalReceipt,
  warehouseApi, type Warehouse,
  logicalLocationApi, type LogicalLocation,
} from "@/lib/api";

// ─── Shared helpers ──────────────────────────────────────────────────────────

function formatDate(ds: string) {
  return new Date(ds).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function ClosedBadge({ closed }: Readonly<{ closed: boolean }>) {
  return <Badge variant={closed ? "destructive" : "default"}>{closed ? "Closed" : "Open"}</Badge>;
}

function StatusBadge({ status }: Readonly<{ status: string }>) {
  return <Badge variant={status === "confirmed" ? "default" : "secondary"}>{status}</Badge>;
}

// ─── Supplier Receipts tab ───────────────────────────────────────────────────

function SupplierReceiptsTab({ warehouseId, warehouses, logicalLocations }: Readonly<{
  warehouseId?: number;
  warehouses: Warehouse[];
  logicalLocations: LogicalLocation[];
}>) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { can } = useCurrentUser();
  const [receipts, setReceipts] = useState<SupplierReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [closedFilter, setClosedFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const supplierLocations = logicalLocations.filter(l => l.location_type === "supplier");

  useEffect(() => {
    setLoading(true);
    supplierReceiptApi.getAll(warehouseId ? { warehouse_id: warehouseId, limit: 200 } : { limit: 200 })
      .then(setReceipts)
      .finally(() => setLoading(false));
  }, [warehouseId]);

  const filtered = receipts
    .filter(r => {
      if (search && !String(r.id).includes(search)) return false;
      if (locationFilter !== "all" && r.target_logical_location_id !== Number(locationFilter)) return false;
      if (closedFilter === "open" && r.closed) return false;
      if (closedFilter === "closed" && !r.closed) return false;
      if (dateFrom || dateTo) {
        const d = r.closed_at ? r.closed_at.slice(0, 10) : null;
        if (!d) return false;
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
      }
      return true;
    })
    .sort((a, b) => a.closed === b.closed ? b.id - a.id : a.closed ? 1 : -1);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder={`${t("search")}…`} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={locationFilter} onValueChange={setLocationFilter}>
              <SelectTrigger className="w-44"><SelectValue placeholder={t("allLocations")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allLocations")}</SelectItem>
                {supplierLocations.map(l => (
                  <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={closedFilter} onValueChange={setClosedFilter}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="open">{t("openReceipt")}</SelectItem>
                <SelectItem value="closed">{t("closedReceipt")}</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-end gap-1">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t("dateFrom")}</p>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36" />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t("dateTo")}</p>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36" />
              </div>
            </div>
            {can('create_receipts') && (
              <Button onClick={() => navigate(`/receipts/create/supplier${warehouseId ? `?warehouse=${warehouseId}` : ""}`)}>
                <Plus className="h-4 w-4 mr-2" />{t("newSupplierReceipt")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("supplierReceipts")} ({filtered.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">{t("noReceiptsFound")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>{t("sourceWarehouse")}</TableHead>
                  <TableHead>{t("targetLocation")}</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>{t("issuedAt")}</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(r => (
                  <TableRow key={r.id}>
                    <TableCell><Badge variant="outline">#{r.id}</Badge></TableCell>
                    <TableCell>{warehouses.find(w => w.id === r.source_warehouse_id)?.name ?? `#${r.source_warehouse_id}`}</TableCell>
                    <TableCell>{logicalLocations.find(l => l.id === r.target_logical_location_id)?.name ?? `#${r.target_logical_location_id}`}</TableCell>
                    <TableCell><ClosedBadge closed={r.closed} /></TableCell>
                    <TableCell><div className="flex items-center gap-1"><Calendar className="h-3 w-3 text-muted-foreground" />{formatDate(r.issued_at)}</div></TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" onClick={() => navigate(`/receipts/supplier/${r.id}${warehouseId ? `?warehouse=${warehouseId}` : ""}`)}>
                        <Eye className="h-4 w-4 mr-1" />View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Internal Receipts tab ───────────────────────────────────────────────────

function InternalReceiptsTab({ warehouseId, warehouses, logicalLocations }: Readonly<{
  warehouseId?: number;
  warehouses: Warehouse[];
  logicalLocations: LogicalLocation[];
}>) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { can } = useCurrentUser();
  const [receipts, setReceipts] = useState<InternalReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [closedFilter, setClosedFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const internalLocations = logicalLocations.filter(l => l.location_type === "internal");

  useEffect(() => {
    setLoading(true);
    internalReceiptApi.getAll(warehouseId ? { warehouse_id: warehouseId, limit: 200 } : { limit: 200 })
      .then(setReceipts)
      .finally(() => setLoading(false));
  }, [warehouseId]);

  const filtered = receipts
    .filter(r => {
      if (search && !String(r.id).includes(search)) return false;
      if (locationFilter !== "all" && r.target_logical_location_id !== Number(locationFilter)) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (closedFilter === "open" && r.closed) return false;
      if (closedFilter === "closed" && !r.closed) return false;
      if (dateFrom || dateTo) {
        const d = r.issued_at.slice(0, 10);
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
      }
      return true;
    })
    .sort((a, b) => a.closed === b.closed ? b.id - a.id : a.closed ? 1 : -1);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder={`${t("search")}…`} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={locationFilter} onValueChange={setLocationFilter}>
              <SelectTrigger className="w-44"><SelectValue placeholder={t("allLocations")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allLocations")}</SelectItem>
                {internalLocations.map(l => (
                  <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="issued">Issued</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={closedFilter} onValueChange={setClosedFilter}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="open">{t("openReceipt")}</SelectItem>
                <SelectItem value="closed">{t("closedReceipt")}</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-end gap-1">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t("dateFrom")}</p>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36" />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t("dateTo")}</p>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36" />
              </div>
            </div>
            {can('create_receipts') && (
              <Button onClick={() => navigate(`/receipts/create/internal${warehouseId ? `?warehouse=${warehouseId}` : ""}`)}>
                <Plus className="h-4 w-4 mr-2" />{t("newInternalReceipt")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("internalReceipts")} ({filtered.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">{t("noReceiptsFound")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>{t("sourceWarehouse")}</TableHead>
                  <TableHead>{t("targetLocation")}</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Closed</TableHead>
                  <TableHead>{t("issuedAt")}</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(r => (
                  <TableRow key={r.id}>
                    <TableCell><Badge variant="outline">#{r.id}</Badge></TableCell>
                    <TableCell>{warehouses.find(w => w.id === r.source_warehouse_id)?.name ?? `#${r.source_warehouse_id}`}</TableCell>
                    <TableCell>{logicalLocations.find(l => l.id === r.target_logical_location_id)?.name ?? `#${r.target_logical_location_id}`}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell><ClosedBadge closed={r.closed} /></TableCell>
                    <TableCell><div className="flex items-center gap-1"><Calendar className="h-3 w-3 text-muted-foreground" />{formatDate(r.issued_at)}</div></TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" onClick={() => navigate(`/receipts/internal/${r.id}${warehouseId ? `?warehouse=${warehouseId}` : ""}`)}>
                        <Eye className="h-4 w-4 mr-1" />View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── External Receipts tab ───────────────────────────────────────────────────

function ExternalReceiptsTab({ warehouseId, warehouses }: Readonly<{
  warehouseId?: number;
  warehouses: Warehouse[];
}>) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { can } = useCurrentUser();
  const [receipts, setReceipts] = useState<ExternalReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [closedFilter, setClosedFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    setLoading(true);
    externalReceiptApi.getAll(warehouseId ? { warehouse_id: warehouseId, limit: 200 } : { limit: 200 })
      .then(setReceipts)
      .finally(() => setLoading(false));
  }, [warehouseId]);

  const filtered = receipts
    .filter(r => {
      if (search && !String(r.id).includes(search) && !r.receiver.toLowerCase().includes(search.toLowerCase())) return false;
      if (closedFilter === "open" && r.closed) return false;
      if (closedFilter === "closed" && !r.closed) return false;
      if (dateFrom || dateTo) {
        const d = r.closed_at ? r.closed_at.slice(0, 10) : null;
        if (!d) return false;
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
      }
      return true;
    })
    .sort((a, b) => a.closed === b.closed ? b.id - a.id : a.closed ? 1 : -1);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder={`${t("search")}…`} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={closedFilter} onValueChange={setClosedFilter}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="open">{t("openReceipt")}</SelectItem>
                <SelectItem value="closed">{t("closedReceipt")}</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-end gap-1">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t("dateFrom")}</p>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36" />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t("dateTo")}</p>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36" />
              </div>
            </div>
            {can('create_receipts') && (
              <Button onClick={() => navigate(`/receipts/create/external${warehouseId ? `?warehouse=${warehouseId}` : ""}`)}>
                <Plus className="h-4 w-4 mr-2" />{t("newExternalReceipt")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("externalReceipts")} ({filtered.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">{t("noReceiptsFound")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>{t("sourceWarehouse")}</TableHead>
                  <TableHead>{t("receiver")}</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>{t("issuedAt")}</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(r => (
                  <TableRow key={r.id}>
                    <TableCell><Badge variant="outline">#{r.id}</Badge></TableCell>
                    <TableCell>{warehouses.find(w => w.id === r.source_warehouse_id)?.name ?? `#${r.source_warehouse_id}`}</TableCell>
                    <TableCell>{r.receiver}</TableCell>
                    <TableCell><ClosedBadge closed={r.closed} /></TableCell>
                    <TableCell><div className="flex items-center gap-1"><Calendar className="h-3 w-3 text-muted-foreground" />{formatDate(r.issued_at)}</div></TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" onClick={() => navigate(`/receipts/external/${r.id}${warehouseId ? `?warehouse=${warehouseId}` : ""}`)}>
                        <Eye className="h-4 w-4 mr-1" />View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

const Receipts = () => {
  const [searchParams] = useSearchParams();
  const warehouseIdParam = searchParams.get("warehouse");
  const warehouseId = warehouseIdParam ? parseInt(warehouseIdParam) : undefined;

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [logicalLocations, setLogicalLocations] = useState<LogicalLocation[]>([]);
  const [refLoading, setRefLoading] = useState(true);

  const { t } = useTranslation();

  useEffect(() => {
    Promise.all([warehouseApi.getAll(), logicalLocationApi.getAll({ limit: 500 })]).then(
      ([ws, lls]) => { setWarehouses(ws); setLogicalLocations(lls); }
    ).finally(() => setRefLoading(false));
  }, []);

  if (refLoading) {
    return (
      <PageTransition>
        <div className="min-h-screen bg-background">
          <div className="absolute top-4 right-4"><LanguageToggle /></div>
          <div className="flex items-center justify-center h-screen">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-primary">{t("loading")}</h1>
            </div>
          </div>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="min-h-screen bg-background flex">
        <Sidebar />
        <main className="flex-1 p-8">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <FileText className="h-8 w-8 text-primary" />
              <h1 className="text-3xl font-bold text-primary">{t("receipts")}</h1>
              {warehouseId && (
                <Badge variant="outline">
                  <Package className="h-3 w-3 mr-1" />
                  {warehouses.find(w => w.id === warehouseId)?.name ?? `Warehouse #${warehouseId}`}
                </Badge>
              )}
            </div>

            <Tabs defaultValue="internal">
              <TabsList className="grid grid-cols-3 w-full max-w-md">
                <TabsTrigger value="supplier">{t("supplierReceipts")}</TabsTrigger>
                <TabsTrigger value="internal">{t("internalReceipts")}</TabsTrigger>
                <TabsTrigger value="external">{t("externalReceipts")}</TabsTrigger>
              </TabsList>

              <TabsContent value="supplier" className="mt-4">
                <SupplierReceiptsTab warehouseId={warehouseId} warehouses={warehouses} logicalLocations={logicalLocations} />
              </TabsContent>
              <TabsContent value="internal" className="mt-4">
                <InternalReceiptsTab warehouseId={warehouseId} warehouses={warehouses} logicalLocations={logicalLocations} />
              </TabsContent>
              <TabsContent value="external" className="mt-4">
                <ExternalReceiptsTab warehouseId={warehouseId} warehouses={warehouses} />
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>
    </PageTransition>
  );
};

export default Receipts;
