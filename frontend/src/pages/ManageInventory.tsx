import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { ChevronDown, ChevronRight, Package, Shirt, Zap, Loader2, Search, Filter, Check, ChevronsUpDown } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/contexts/LanguageContext";
import LanguageToggle from "@/components/LanguageToggle";
import { boxApi, boxContentApi, warehouseApi, warehouseRackApi, type Warehouse, type Box, type WarehouseRack, type BoxAggregation } from "@/lib/api";
import type { WarehouseType } from "@/lib/api/warehouses";

type BoxWithContents = Box & { 
  contents: import("@/lib/api/box-contents").BoxContent[];
  rack?: WarehouseRack;
};

const ManageInventory = () => {
  const [searchParams] = useSearchParams();
  const warehouseIdParam = searchParams.get("warehouse");
  const warehouseId = warehouseIdParam ? parseInt(warehouseIdParam) : undefined;

  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [boxesWithContents, setBoxesWithContents] = useState<BoxWithContents[]>([]);
  const [aggregatedBoxes, setAggregatedBoxes] = useState<BoxAggregation[]>([]);
  const [expandedBoxIds, setExpandedBoxIds] = useState<Set<number>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [filters, setFilters] = useState({
    jobOrderItem: "all",
    rackCode: "all",
    client: "all",
    model: "all",
    color: "all",
    size: "all"
  });
  const [openDropdowns, setOpenDropdowns] = useState({
    jobOrderItem: false,
    rackCode: false,
    client: false,
    model: false,
    color: false,
    size: false
  });

  const { t } = useTranslation();
  const { language } = useLanguage();

  const warehouseIcon = (type: WarehouseType | undefined) => {
    switch (type) {
      case 'Fabric':
        return <Package className="h-5 w-5" />;
      case 'RMG':
        return <Shirt className="h-5 w-5" />;
      case 'Accessory':
        return <Zap className="h-5 w-5" />;
      default:
        return <Package className="h-5 w-5" />;
    }
  };

  useEffect(() => {
    const load = async () => {
      if (!warehouseId) {
        setError("Warehouse is required");
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const w = await warehouseApi.getById(warehouseId);
        setWarehouse(w);

        if (w.type === 'RMG') {
          // Use the new aggregated endpoint for better performance
          const aggregatedData = await boxApi.getAggregated({ warehouse_id: warehouseId });
          setAggregatedBoxes(aggregatedData);
          
          // Keep the old method for detailed content view (when expanding boxes)
          const fetchedBoxes = await boxApi.getAll();
          const boxesWithContentPromises = fetchedBoxes.map(async (b) => {
            const [contents, rack] = await Promise.all([
              boxContentApi.getByBox(b.id),
              b.rack_id ? warehouseRackApi.getById(b.rack_id).catch(() => null) : Promise.resolve(null)
            ]);
            return { ...b, contents, rack } as BoxWithContents;
          });
          const boxesWithContent = await Promise.all(boxesWithContentPromises);
          setBoxesWithContents(boxesWithContent);
        } else {
          // Placeholder for other warehouse types; keep empty for now
          setAggregatedBoxes([]);
          setBoxesWithContents([]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load inventory");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [warehouseId]);

  const toggleExpand = (boxId: number) => {
    setExpandedBoxIds(prev => {
      const next = new Set(prev);
      if (next.has(boxId)) next.delete(boxId); else next.add(boxId);
      return next;
    });
  };


  // Get unique values for filter dropdowns from aggregated data
  const uniqueValues = useMemo(() => {
    const models = new Set<string>();
    const colors = new Set<string>();
    const sizes = new Set<string>();
    const rackCodes = new Set<string>();
    const jobOrderItems = new Set<string>();
    const clients = new Set<string>();

    aggregatedBoxes.forEach(box => {
      if (box.rack_code) rackCodes.add(box.rack_code);
      if (box.client_name) clients.add(box.client_name);
      box.model_names.forEach(model => models.add(model));
      box.color_names.forEach(color => colors.add(color));
      box.size_values.forEach(size => sizes.add(size));
      box.job_order_item_ids.forEach(joId => jobOrderItems.add(`JO-${joId}`));
    });

    return {
      models: Array.from(models).sort(),
      colors: Array.from(colors).sort(),
      sizes: Array.from(sizes).sort(),
      rackCodes: Array.from(rackCodes).sort(),
      jobOrderItems: Array.from(jobOrderItems).sort(),
      clients: Array.from(clients).sort()
    };
  }, [aggregatedBoxes]);

  const filteredBoxes = useMemo(() => {
    return aggregatedBoxes.filter(box => {
      // General search term (barcode only)
      const matchesSearch = !searchTerm || 
        box.barcode.toLowerCase().includes(searchTerm.toLowerCase());

      // Job order item filter
      const matchesJobOrder = !filters.jobOrderItem || filters.jobOrderItem === "all" ||
        box.job_order_item_ids.some(joId => 
          `JO-${joId}`.toLowerCase().includes(filters.jobOrderItem.toLowerCase())
        );

      // Rack code filter
      const matchesRackCode = !filters.rackCode || filters.rackCode === "all" ||
        box.rack_code?.toLowerCase().includes(filters.rackCode.toLowerCase());

      // Client filter
      const matchesClient = !filters.client || filters.client === "all" ||
        box.client_name?.toLowerCase().includes(filters.client.toLowerCase());

      // Model filter
      const matchesModel = !filters.model || filters.model === "all" ||
        box.model_names.some(model => 
          model.toLowerCase().includes(filters.model.toLowerCase())
        );

      // Color filter
      const matchesColor = !filters.color || filters.color === "all" ||
        box.color_names.some(color => 
          color.toLowerCase().includes(filters.color.toLowerCase())
        );

      // Size filter
      const matchesSize = !filters.size || filters.size === "all" ||
        box.size_values.some(size => 
          size.toLowerCase().includes(filters.size.toLowerCase())
        );

      return matchesSearch && matchesJobOrder && matchesRackCode && 
             matchesClient && matchesModel && matchesColor && matchesSize;
    });
  }, [aggregatedBoxes, searchTerm, filters]);

  const handleFilterChange = (filterKey: string, value: string) => {
    setFilters(prev => ({ ...prev, [filterKey]: value }));
  };

  const toggleDropdown = (dropdownKey: string) => {
    setOpenDropdowns(prev => ({ ...prev, [dropdownKey]: !prev[dropdownKey as keyof typeof prev] }));
  };

  const clearFilters = () => {
    setFilters({
      jobOrderItem: "all",
      rackCode: "all",
      client: "all",
      model: "all",
      color: "all",
      size: "all"
    });
    setSearchTerm("");
  };

  // Reusable searchable select component
  const SearchableSelect = ({ 
    label, 
    placeholder, 
    value, 
    options, 
    onValueChange, 
    dropdownKey 
  }: {
    label: string;
    placeholder: string;
    value: string;
    options: string[];
    onValueChange: (value: string) => void;
    dropdownKey: string;
  }) => {
    const isOpen = openDropdowns[dropdownKey as keyof typeof openDropdowns];
    
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <Popover open={isOpen} onOpenChange={() => toggleDropdown(dropdownKey)}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={isOpen}
              className="w-full justify-between"
            >
              {value === "all" ? placeholder : value}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-full p-0" align="start">
            <Command>
              <CommandInput placeholder={`Search ${label.toLowerCase()}...`} />
              <CommandList>
                <CommandEmpty>No {label.toLowerCase()} found.</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="all"
                    onSelect={() => {
                      onValueChange("all");
                      toggleDropdown(dropdownKey);
                    }}
                  >
                    <Check
                      className={`mr-2 h-4 w-4 ${
                        value === "all" ? "opacity-100" : "opacity-0"
                      }`}
                    />
                    All {label.toLowerCase()}
                  </CommandItem>
                  {options.map((option) => (
                    <CommandItem
                      key={option}
                      value={option}
                      onSelect={() => {
                        onValueChange(option);
                        toggleDropdown(dropdownKey);
                      }}
                    >
                      <Check
                        className={`mr-2 h-4 w-4 ${
                          value === option ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      {option}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    );
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
              {warehouseIcon(warehouse?.type)}
              <h1 className="text-3xl font-bold text-primary">
                {warehouse?.name ? `${warehouse.name} Inventory` : 'Inventory'}
              </h1>
            </div>

            {error && (
              <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md">
                <p className="text-destructive">{error}</p>
              </div>
            )}

            {warehouse?.type === 'RMG' ? (
              <>
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
                    <div className="space-y-4">
                      {/* General Search */}
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search by barcode..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-10"
                        />
                      </div>

                      {/* Filter Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {/* Job Order Item Filter */}
                        <SearchableSelect
                          label="Job Order Item"
                          placeholder="All job orders"
                          value={filters.jobOrderItem}
                          options={uniqueValues.jobOrderItems}
                          onValueChange={(value) => handleFilterChange('jobOrderItem', value)}
                          dropdownKey="jobOrderItem"
                        />

                        {/* Rack Code Filter */}
                        <SearchableSelect
                          label="Rack Code"
                          placeholder="All racks"
                          value={filters.rackCode}
                          options={uniqueValues.rackCodes}
                          onValueChange={(value) => handleFilterChange('rackCode', value)}
                          dropdownKey="rackCode"
                        />

                        {/* Client Filter */}
                        <SearchableSelect
                          label="Client"
                          placeholder="All clients"
                          value={filters.client}
                          options={uniqueValues.clients}
                          onValueChange={(value) => handleFilterChange('client', value)}
                          dropdownKey="client"
                        />

                        {/* Model Filter */}
                        <SearchableSelect
                          label="Model"
                          placeholder="All models"
                          value={filters.model}
                          options={uniqueValues.models}
                          onValueChange={(value) => handleFilterChange('model', value)}
                          dropdownKey="model"
                        />

                        {/* Color Filter */}
                        <SearchableSelect
                          label="Color"
                          placeholder="All colors"
                          value={filters.color}
                          options={uniqueValues.colors}
                          onValueChange={(value) => handleFilterChange('color', value)}
                          dropdownKey="color"
                        />

                        {/* Size Filter */}
                        <SearchableSelect
                          label="Size"
                          placeholder="All sizes"
                          value={filters.size}
                          options={uniqueValues.sizes}
                          onValueChange={(value) => handleFilterChange('size', value)}
                          dropdownKey="size"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Inventory Table */}
                <Card>
                  <CardHeader>
                    <CardTitle>Inventory ({filteredBoxes.length} boxes)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <div className="text-center py-8">{t('loading')}</div>
                    ) : filteredBoxes.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        {searchTerm ? 'No boxes found matching your search.' : 'No boxes found.'}
                      </div>
                    ) : (
                      <Table>
                         <TableHeader>
                           <TableRow>
                             <TableHead>Barcode</TableHead>
                             <TableHead>Rack Code</TableHead>
                             <TableHead>Total Pieces</TableHead>
                             <TableHead>Models</TableHead>
                             <TableHead>Colors</TableHead>
                             <TableHead>Sizes</TableHead>
                             <TableHead>Client</TableHead>
                             <TableHead>Actions</TableHead>
                           </TableRow>
                         </TableHeader>
                        <TableBody>
                          {filteredBoxes.map((box) => {
                            const isExpanded = expandedBoxIds.has(box.box_id);
                            // Find the corresponding detailed box for expansion
                            const detailedBox = boxesWithContents.find(b => b.id === box.box_id);
                            return (
                              <>
                                 <TableRow key={box.box_id}>
                                   <TableCell>
                                     <Badge variant="outline">{box.barcode}</Badge>
                                   </TableCell>
                                   <TableCell>
                                     {box.rack_code ? (
                                       <Badge variant="secondary">{box.rack_code}</Badge>
                                     ) : (
                                       <span className="text-muted-foreground text-sm">No rack assigned</span>
                                     )}
                                   </TableCell>
                                   <TableCell className="font-medium">{box.total_pieces}</TableCell>
                                   <TableCell>
                                     <div className="flex flex-wrap gap-1">
                                       {box.model_names.slice(0, 3).map((model, idx) => (
                                         <Badge key={idx} variant="secondary" className="text-xs">{model}</Badge>
                                       ))}
                                       {box.model_names.length > 3 && (
                                         <Badge variant="outline" className="text-xs">
                                           +{box.model_names.length - 3} more
                                         </Badge>
                                       )}
                                     </div>
                                   </TableCell>
                                   <TableCell>
                                     <div className="flex flex-wrap gap-1">
                                       {box.color_names.slice(0, 3).map((color, idx) => (
                                         <Badge key={idx} variant="outline" className="text-xs">{color}</Badge>
                                       ))}
                                       {box.color_names.length > 3 && (
                                         <Badge variant="secondary" className="text-xs">
                                           +{box.color_names.length - 3} more
                                         </Badge>
                                       )}
                                     </div>
                                   </TableCell>
                                   <TableCell>
                                     <div className="flex flex-wrap gap-1">
                                       {box.size_values.slice(0, 3).map((size, idx) => (
                                         <Badge key={idx} variant="outline" className="text-xs">{size}</Badge>
                                       ))}
                                       {box.size_values.length > 3 && (
                                         <Badge variant="secondary" className="text-xs">
                                           +{box.size_values.length - 3} more
                                         </Badge>
                                       )}
                                     </div>
                                   </TableCell>
                                          <TableCell>
                                            {box.client_name ? (
                                              <Badge variant="secondary">{box.client_name}</Badge>
                                            ) : (
                                              <span className="text-sm text-muted-foreground">No client assigned</span>
                                            )}
                                          </TableCell>
                                   <TableCell>
                                     <Button variant="ghost" size="sm" onClick={() => toggleExpand(box.box_id)}>
                                       {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                     </Button>
                                   </TableCell>
                                 </TableRow>
                                {isExpanded && detailedBox && (
                                  <TableRow>
                                    <TableCell colSpan={8} className="p-0">
                                      <div className="border-t bg-muted/20 p-4">
                                        <h4 className="font-medium mb-3">Box Contents</h4>
                                        <div className="space-y-2 max-h-60 overflow-auto">
                                          {detailedBox.contents.map((content) => (
                                            <div key={content.id} className="border rounded-md p-3 bg-background">
                                              <div className="flex flex-wrap items-center gap-2 text-sm">
                                                {content.model?.name && <Badge variant="secondary">{content.model.name}</Badge>}
                                                {content.color?.name && <Badge variant="outline">{content.color.name}</Badge>}
                                                {content.size?.value && <Badge variant="outline">{content.size.value}</Badge>}
                                                <Badge variant="default">{content.piece_count} pcs</Badge>
                                                {typeof content.weight === 'number' && <Badge variant="outline">{content.weight} kg</Badge>}
                                              </div>
                                              {content.job_order_item_id && (
                                                <div className="text-xs text-muted-foreground mt-1">
                                                  JO Item: {content.job_order_item_id}
                                                </div>
                                              )}
                                            </div>
                                          ))}
                                          {detailedBox.contents.length === 0 && (
                                            <div className="text-sm text-muted-foreground">No contents in this box.</div>
                                          )}
                                        </div>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                )}
                              </>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Inventory view for {warehouse?.type || 'this warehouse'} is not implemented yet.</CardTitle>
                </CardHeader>
              </Card>
            )}
          </div>
        </main>
      </div>
    </PageTransition>
  );
};

export default ManageInventory;


