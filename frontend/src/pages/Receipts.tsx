import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronsUpDown } from "lucide-react";
import { FileText, Search, Filter, Loader2, Eye, Calendar, User, Package, Plus, Save } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/contexts/LanguageContext";
import LanguageToggle from "@/components/LanguageToggle";
import { receiptApi, warehouseApi, logicalLocationApi, type Receipt, type ReceiptCreate, type Warehouse, type LogicalLocation } from "@/lib/api";

const Receipts = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const warehouseIdParam = searchParams.get("warehouse");
  const warehouseId = warehouseIdParam ? parseInt(warehouseIdParam) : undefined;

  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentWarehouse, setCurrentWarehouse] = useState<Warehouse | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [closedFilter, setClosedFilter] = useState<string>("all");
  
  // Create receipt form state
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [formData, setFormData] = useState<ReceiptCreate>({
    receipt_type: 'dyehouse',
    source_location_id: undefined,
    target_location_id: undefined,
    status: 'issued'
  });

  // Location data state
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [logicalLocations, setLogicalLocations] = useState<LogicalLocation[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [openDropdowns, setOpenDropdowns] = useState({
    sourceLocation: false,
    targetLocation: false
  });
  const [forceUpdate, setForceUpdate] = useState(0);

  // Get available receipt types based on current warehouse context
  const getAvailableReceiptTypes = () => {
    // If no current warehouse context, return all types
    if (!currentWarehouse) {
      return [
        { value: 'dyehouse', label: 'Dyehouse' },
        { value: 'cutting', label: 'Cutting' },
        { value: 'shipping', label: 'Shipping' }
      ];
    }

    // Check if current warehouse is RMG
    const isRMG = currentWarehouse.type === 'RMG';
    
    if (isRMG) {
      return [{ value: 'shipping', label: 'Shipping' }];
    }
    
    return [
      { value: 'dyehouse', label: 'Dyehouse' },
      { value: 'cutting', label: 'Cutting' },
      { value: 'shipping', label: 'Shipping' }
    ];
  };

  const { t } = useTranslation();
  const { language } = useLanguage();

  useEffect(() => {
    const loadReceipts = async () => {
      try {
        setLoading(true);
        const receiptsData = await receiptApi.getAll({ limit: 100 });
        
        // Filter receipts based on current warehouse type
        let filteredReceipts = receiptsData;
        if (currentWarehouse?.type === 'RMG') {
          // For RMG warehouses, only show shipping receipts
          filteredReceipts = receiptsData.filter(receipt => receipt.receipt_type === 'shipping');
        }
        
        setReceipts(filteredReceipts);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load receipts");
      } finally {
        setLoading(false);
      }
    };

    loadReceipts();
  }, [currentWarehouse]);

  useEffect(() => {
    const loadLocations = async () => {
      try {
        setLocationsLoading(true);
        const [warehousesData, logicalLocationsData] = await Promise.all([
          warehouseApi.getAll(),
          logicalLocationApi.getAll({ limit: 100 })
        ]);
        setWarehouses(warehousesData);
        setLogicalLocations(logicalLocationsData);
      } catch (e) {
        console.error("Failed to load locations:", e);
      } finally {
        setLocationsLoading(false);
      }
    };

    loadLocations();
  }, []);

  // Separate effect to set current warehouse after warehouses are loaded
  useEffect(() => {
    if (warehouses.length > 0 && warehouseId) {
      const currentWarehouseData = warehouses.find(w => w.id === warehouseId);
      if (currentWarehouseData) {
        setCurrentWarehouse(currentWarehouseData);
      }
    }
  }, [warehouses, warehouseId]);

  // Auto-set receipt type to shipping when RMG warehouse is selected
  useEffect(() => {
    if (currentWarehouse) {
      const availableTypes = getAvailableReceiptTypes();
      
      if (availableTypes.length === 1 && availableTypes[0].value === 'shipping') {
        // If only shipping is available, set it as the receipt type
        if (formData.receipt_type !== 'shipping') {
          setFormData(prev => ({ ...prev, receipt_type: 'shipping' }));
        }
      }
      // Force re-render of the dropdown
      setForceUpdate(prev => prev + 1);
    }
  }, [currentWarehouse]);

  // Auto-set source location to current warehouse
  useEffect(() => {
    if (currentWarehouse && formData.source_location_id !== currentWarehouse.id) {
      setFormData(prev => ({ ...prev, source_location_id: currentWarehouse.id }));
    }
  }, [currentWarehouse]);

  const filteredReceipts = receipts.filter(receipt => {
    const matchesSearch = !searchTerm || 
      receipt.id.toString().includes(searchTerm) ||
      receipt.receipt_type.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || receipt.status === statusFilter;
    const matchesType = typeFilter === "all" || receipt.receipt_type === typeFilter;
    const matchesClosed = closedFilter === "all" || 
      (closedFilter === "closed" && receipt.closed) ||
      (closedFilter === "open" && !receipt.closed);

    return matchesSearch && matchesStatus && matchesType && matchesClosed;
  });

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'confirmed':
        return 'default';
      case 'issued':
        return 'secondary';
      case 'cancelled':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  const getTypeBadgeVariant = (type: string) => {
    switch (type) {
      case 'inbound':
        return 'default';
      case 'dyehouse':
        return 'secondary';
      case 'cutting':
        return 'outline';
      case 'shipping':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleViewReceipt = (receiptId: number) => {
    navigate(`/receipts/${receiptId}`);
  };

  const clearFilters = () => {
    setSearchTerm("");
    setStatusFilter("all");
    setTypeFilter("all");
    setClosedFilter("all");
  };

  const handleFormChange = (field: keyof ReceiptCreate, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleCreateReceipt = async () => {
    try {
      setCreateLoading(true);
      setCreateError(null);
      setCreateSuccess(null);

      // For now, we'll use a placeholder user ID
      // In a real app, this would come from authentication
      const issuedBy = 1;
      
      const newReceipt = await receiptApi.create(formData, issuedBy);
      
      setCreateSuccess(`Receipt #${newReceipt.id} created successfully!`);
      
      // Reset form
      setFormData({
        receipt_type: 'inbound',
        source_location_id: undefined,
        target_location_id: undefined,
        status: 'issued'
      });

      // Refresh receipts list
      const receiptsData = await receiptApi.getAll({ limit: 100 });
      setReceipts(receiptsData);
      
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create receipt");
    } finally {
      setCreateLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      receipt_type: 'dyehouse',
      source_location_id: undefined,
      target_location_id: undefined,
      status: 'issued'
    });
    setCreateError(null);
    setCreateSuccess(null);
  };

  const toggleDropdown = (dropdownKey: string) => {
    setOpenDropdowns(prev => ({ ...prev, [dropdownKey]: !prev[dropdownKey as keyof typeof prev] }));
  };

  const getLocationName = (locationId: number | undefined) => {
    if (!locationId) return "Select location";
    
    // Check warehouses first
    const warehouse = warehouses.find(w => w.id === locationId);
    if (warehouse) return warehouse.name;
    
    // Check logical locations
    const logicalLocation = logicalLocations.find(l => l.id === locationId);
    if (logicalLocation) return logicalLocation.name;
    
    return `Location #${locationId}`;
  };

  const getAllLocations = () => {
    const allLocations = [
      ...warehouses.map(w => ({ id: w.id, name: w.name, type: 'warehouse' })),
      ...logicalLocations.map(l => ({ id: l.id, name: l.name, type: 'logical' }))
    ];
    return allLocations.sort((a, b) => a.name.localeCompare(b.name));
  };

  if (loading) {
    return (
      <PageTransition>
        <div className={`min-h-screen bg-background ${language === 'ar' ? 'rtl' : 'ltr'}`}>
          <div className="absolute top-4 right-4">
            <LanguageToggle />
          </div>
          <div className="flex items-center justify-center h-screen">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-primary">{t('loading')}</h1>
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
              <h1 className="text-3xl font-bold text-primary">Receipts</h1>
            </div>

            {error && (
              <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md">
                <p className="text-destructive">{error}</p>
              </div>
            )}

            {/* Tabs */}
                <Tabs defaultValue="view" className="w-full">
                  <TabsList className={`grid w-full ${currentWarehouse?.type === 'RMG' ? 'grid-cols-1' : 'grid-cols-2'}`}>
                    <TabsTrigger value="view" className="flex items-center gap-2">
                      <Eye className="h-4 w-4" />
                      View Receipts
                    </TabsTrigger>
                    {currentWarehouse?.type !== 'RMG' && (
                      <TabsTrigger value="create" className="flex items-center gap-2">
                        <Plus className="h-4 w-4" />
                        Create Receipt
                      </TabsTrigger>
                    )}
                  </TabsList>

              {/* View Receipts Tab */}
              <TabsContent value="view" className="space-y-6">
                {/* Search and Filters */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <div className="flex items-center">
                        <Filter className="mr-2 h-4 w-4" />
                        Search & Filters
                      </div>
                      <Button variant="outline" size="sm" onClick={clearFilters}>
                        Clear All
                      </Button>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      {/* Search */}
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search by ID or type..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-10"
                        />
                      </div>

                      {/* Status Filter */}
                      <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger>
                          <SelectValue placeholder="Filter by status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Statuses</SelectItem>
                          <SelectItem value="issued">Issued</SelectItem>
                          <SelectItem value="confirmed">Confirmed</SelectItem>
                          <SelectItem value="cancelled">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>

                      {/* Type Filter */}
                      <Select value={typeFilter} onValueChange={setTypeFilter}>
                        <SelectTrigger>
                          <SelectValue placeholder="Filter by type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Types</SelectItem>
                          <SelectItem value="dyehouse">Dyehouse</SelectItem>
                          <SelectItem value="cutting">Cutting</SelectItem>
                          <SelectItem value="shipping">Shipping</SelectItem>
                        </SelectContent>
                      </Select>

                      {/* Closed Filter */}
                      <Select value={closedFilter} onValueChange={setClosedFilter}>
                        <SelectTrigger>
                          <SelectValue placeholder="Filter by closed status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Receipts</SelectItem>
                          <SelectItem value="open">Open</SelectItem>
                          <SelectItem value="closed">Closed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                {/* Receipts Table */}
                <Card>
                  <CardHeader>
                    <CardTitle>Receipts ({filteredReceipts.length} total)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {filteredReceipts.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        {searchTerm || statusFilter !== "all" || typeFilter !== "all" 
                          ? 'No receipts found matching your filters.' 
                          : 'No receipts found.'}
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>ID</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Closed</TableHead>
                            <TableHead>Reference</TableHead>
                            <TableHead>Issued By</TableHead>
                            <TableHead>Issued At</TableHead>
                            <TableHead>Confirmed At</TableHead>
                            <TableHead>Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredReceipts.map((receipt) => (
                            <TableRow key={receipt.id}>
                              <TableCell className="font-medium">
                                <Badge variant="outline">#{receipt.id}</Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant={getTypeBadgeVariant(receipt.receipt_type)}>
                                  {receipt.receipt_type}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant={getStatusBadgeVariant(receipt.status)}>
                                  {receipt.status}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant={receipt.closed ? "destructive" : "default"}>
                                  {receipt.closed ? "Closed" : "Open"}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {receipt.reference_receipt_id ? (
                                  <Badge variant="secondary">
                                    Ref #{receipt.reference_receipt_id}
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground text-sm">-</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <User className="h-4 w-4 text-muted-foreground" />
                                  <span>User #{receipt.issued_by}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Calendar className="h-4 w-4 text-muted-foreground" />
                                  <span>{formatDate(receipt.issued_at)}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                {receipt.confirmed_at ? (
                                  <div className="flex items-center gap-2">
                                    <Calendar className="h-4 w-4 text-muted-foreground" />
                                    <span>{formatDate(receipt.confirmed_at)}</span>
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">Not confirmed</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  onClick={() => handleViewReceipt(receipt.id)}
                                >
                                  <Eye className="h-4 w-4 mr-2" />
                                  View Details
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Create Receipt Tab */}
              {currentWarehouse?.type !== 'RMG' && (
                <TabsContent value="create" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Plus className="h-5 w-5" />
                      Create New Receipt
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {createError && (
                      <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md">
                        <p className="text-destructive">{createError}</p>
                      </div>
                    )}

                    {createSuccess && (
                      <div className="p-4 bg-green-50 border border-green-200 rounded-md">
                        <p className="text-green-800">{createSuccess}</p>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Receipt Type */}
                      <div className="space-y-2">
                        <Label htmlFor="receipt_type">Receipt Type *</Label>
                        <Select 
                          value={formData.receipt_type} 
                          onValueChange={(value) => handleFormChange('receipt_type', value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select receipt type" />
                          </SelectTrigger>
                          <SelectContent>
                            {getAvailableReceiptTypes().map((type) => (
                              <SelectItem key={`${type.value}-${forceUpdate}`} value={type.value}>
                                {type.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>


                      {/* Source Location */}
                      <div className="space-y-2">
                        <Label>Source Location</Label>
                        <div className="flex items-center gap-2 p-3 border rounded-md bg-muted/50">
                          <Package className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">
                            {currentWarehouse ? currentWarehouse.name : "Loading..."}
                          </span>
                          <Badge variant="outline" className="ml-auto">
                            Current Warehouse
                          </Badge>
                        </div>
                      </div>

                      {/* Target Location */}
                      <div className="space-y-2">
                        <Label>Target Location</Label>
                        <Popover open={openDropdowns.targetLocation} onOpenChange={() => toggleDropdown('targetLocation')}>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              role="combobox"
                              aria-expanded={openDropdowns.targetLocation}
                              className="w-full justify-between"
                            >
                              {getLocationName(formData.target_location_id)}
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-full p-0" align="start">
                            <Command>
                              <CommandInput placeholder="Search locations..." />
                              <CommandList>
                                <CommandEmpty>No locations found.</CommandEmpty>
                                <CommandGroup>
                                  <CommandItem
                                    value="none"
                                    onSelect={() => {
                                      handleFormChange('target_location_id', undefined);
                                      toggleDropdown('targetLocation');
                                    }}
                                  >
                                    <Check
                                      className={`mr-2 h-4 w-4 ${
                                        formData.target_location_id === undefined ? "opacity-100" : "opacity-0"
                                      }`}
                                    />
                                    No target location
                                  </CommandItem>
                                  {getAllLocations().map((location) => (
                                    <CommandItem
                                      key={`${location.type}-${location.id}`}
                                      value={`${location.type}-${location.id}`}
                                      onSelect={() => {
                                        handleFormChange('target_location_id', location.id);
                                        toggleDropdown('targetLocation');
                                      }}
                                    >
                                      <Check
                                        className={`mr-2 h-4 w-4 ${
                                          formData.target_location_id === location.id ? "opacity-100" : "opacity-0"
                                        }`}
                                      />
{location.name}
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-2 pt-4">
                      <Button 
                        onClick={handleCreateReceipt} 
                        disabled={createLoading}
                        className="flex items-center gap-2"
                      >
                        {createLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                        {createLoading ? 'Creating...' : 'Create Receipt'}
                      </Button>
                      <Button variant="outline" onClick={resetForm}>
                        Reset Form
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              )}
            </Tabs>
          </div>
        </main>
      </div>
    </PageTransition>
  );
};

export default Receipts;
