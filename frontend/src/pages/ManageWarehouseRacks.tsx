import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Search, Trash, Layers, Printer } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import PrintDialog from "@/components/PrintDialog";
import { warehouseRackApi, warehouseApi, WarehouseRack, Warehouse } from "@/lib/api";
import { RackLabelData } from "@/lib/zpl/labelTemplates";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";

const ManageWarehouseRacks = () => {
  const [searchParams] = useSearchParams();
  const currentWarehouseId = searchParams.get("warehouse");
  const { t } = useTranslation();
  
  const [racks, setRacks] = useState<WarehouseRack[]>([]);
  const [currentWarehouse, setCurrentWarehouse] = useState<Warehouse | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRacks, setSelectedRacks] = useState<Set<number>>(new Set());
  const [isGroupDeleteDialogOpen, setIsGroupDeleteDialogOpen] = useState(false);
  const [groupDeletePrefix, setGroupDeletePrefix] = useState("");
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
  const [racksToPrint, setRacksToPrint] = useState<RackLabelData[]>([]);
  const { toast } = useToast();

  // Bulk creation state
  const [bulkData, setBulkData] = useState({
    rack_group: "",
    rack_count: "",
  });

  useEffect(() => {
    if (currentWarehouseId) {
      loadData();
    }
  }, [currentWarehouseId]);

  // The API caps each request at 100 racks, so page through until the
  // warehouse's full rack list is loaded
  const loadAllRacks = async (warehouseId: number) => {
    const pageSize = 100;
    const allRacks: WarehouseRack[] = [];
    let skip = 0;
    while (true) {
      const page = await warehouseRackApi.getAll(warehouseId, skip, pageSize);
      allRacks.push(...page);
      if (page.length < pageSize) break;
      skip += pageSize;
    }
    return allRacks;
  };

  const loadData = async () => {
    if (!currentWarehouseId) return;

    try {
      setLoading(true);
      const [racksData, warehouseData] = await Promise.all([
        loadAllRacks(parseInt(currentWarehouseId)),
        warehouseApi.getById(parseInt(currentWarehouseId))
      ]);
      setRacks(racksData);
      setCurrentWarehouse(warehouseData);
    } catch (error) {
      toast({
        title: t("error"),
        description: t("failedToLoadWarehouseRacks"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredRacks = racks.filter(rack => {
    const matchesSearch = rack.rack_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         rack.warehouse?.name.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  // Letters already used by existing racks of this group in the current
  // warehouse (any level counts)
  const getUsedLetters = () => {
    const prefix = `${t("rackPrefix")}${bulkData.rack_group}`.toUpperCase();
    const warehouseId = currentWarehouseId ? parseInt(currentWarehouseId) : null;
    const used = new Set<string>();
    racks.forEach(rack => {
      if (warehouseId !== null && rack.warehouse_id !== warehouseId) return;
      const code = rack.rack_code.toUpperCase();
      if (code.startsWith(prefix) && code.length === prefix.length + 2) {
        const letter = code.charAt(prefix.length);
        if (letter >= "A" && letter <= "Z") {
          used.add(letter);
        }
      }
    });
    return used;
  };

  const getAssignedLetters = () => {
    const count = parseInt(bulkData.rack_count, 10);
    if (!bulkData.rack_group.trim() || isNaN(count) || count <= 0) return [];
    const used = getUsedLetters();
    const letters: string[] = [];
    for (let charCode = 65; charCode <= 90 && letters.length < count; charCode++) {
      const letter = String.fromCharCode(charCode);
      if (!used.has(letter)) {
        letters.push(letter);
      }
    }
    return letters;
  };

  const generateRackCodes = () => {
    const codes: string[] = [];
    getAssignedLetters().forEach(letter => {
      // Always create both upper and lower levels
      codes.push(`${t("rackPrefix")}${bulkData.rack_group}${letter}${t("lowerLevelSuffix")}`); // Lower level
      codes.push(`${t("rackPrefix")}${bulkData.rack_group}${letter}${t("upperLevelSuffix")}`); // Upper level
    });
    return codes;
  };

  const handleBulkCreate = async () => {
    try {
      if (!bulkData.rack_group.trim()) {
        toast({
          title: t("error"),
          description: t("pleaseEnterRackGroupNumber"),
          variant: "destructive",
        });
        return;
      }

      if (!currentWarehouseId) {
        toast({
          title: t("error"),
          description: t("noWarehouseSelected"),
          variant: "destructive",
        });
        return;
      }

      const requestedCount = parseInt(bulkData.rack_count, 10);
      if (isNaN(requestedCount) || requestedCount <= 0) {
        toast({
          title: t("error"),
          description: t("pleaseEnterValidNumberOfRacks"),
          variant: "destructive",
        });
        return;
      }

      const assignedLetters = getAssignedLetters();

      if (assignedLetters.length === 0) {
        toast({
          title: t("error"),
          description: t("allLettersUsedForGroup", { group: bulkData.rack_group }),
          variant: "destructive",
        });
        return;
      }

      if (assignedLetters.length < requestedCount) {
        toast({
          title: t("warning"),
          description: t("onlyLettersAvailableForGroup", { count: assignedLetters.length, group: bulkData.rack_group }),
        });
      }

      const rackCodes = generateRackCodes();

      if (rackCodes.length === 0) {
        toast({
          title: t("error"),
          description: t("noRackCodesToCreate"),
          variant: "destructive",
        });
        return;
      }

      // Create all racks
      const promises = rackCodes.map(code => 
        warehouseRackApi.create({
          warehouse_id: parseInt(currentWarehouseId),
          rack_code: code,
        })
      );

      await Promise.all(promises);

      toast({
        title: t("success"),
        description: t("createdWarehouseRacksSuccessfully", { count: rackCodes.length }),
      });

      // Prepare rack data for printing
      const createdRacks = rackCodes.map(rackCode => ({
        rackCode,
        warehouseName: currentWarehouse?.name || t("unknown"),
        warehouseId: parseInt(currentWarehouseId || t("defaultWarehouseId")),
        createdDate: new Date().toLocaleDateString()
      }));

      setRacksToPrint(createdRacks);
      setIsDialogOpen(false);
      setBulkData({ rack_group: "", rack_count: "" });
      loadData();
      
      // Open print dialog
      setIsPrintDialogOpen(true);
    } catch (error) {
      toast({
        title: t("error"),
        description: error instanceof Error ? error.message : t("failedToCreateWarehouseRacks"),
        variant: "destructive",
      });
    }
  };



  const handleDelete = async (id: number) => {
    try {
      await warehouseRackApi.delete(id);
      toast({
        title: t("success"),
        description: t("warehouseRackDeletedSuccessfully"),
      });
      loadData();
    } catch (error) {
      toast({
        title: t("error"),
        description: error instanceof Error ? error.message : t("failedToDeleteWarehouseRack"),
        variant: "destructive",
      });
    }
  };

  const handleGroupDelete = async () => {
    try {
      if (!groupDeletePrefix.trim()) {
        toast({
          title: t("error"),
          description: t("pleaseEnterRackGroupPrefix"),
          variant: "destructive",
        });
        return;
      }

      // Find all racks that start with the given prefix
      const racksToDelete = racks.filter(rack => 
        rack.rack_code.toUpperCase().startsWith(groupDeletePrefix.toUpperCase())
      );

      if (racksToDelete.length === 0) {
        toast({
          title: t("error"),
          description: t("noRacksFoundWithPrefix", { prefix: groupDeletePrefix }),
          variant: "destructive",
        });
        return;
      }

      // Delete all racks in the group
      const promises = racksToDelete.map(rack => warehouseRackApi.delete(rack.id));
      await Promise.all(promises);

      toast({
        title: t("success"),
        description: t("deletedRacksWithPrefix", { count: racksToDelete.length, prefix: groupDeletePrefix }),
      });

      setIsGroupDeleteDialogOpen(false);
      setGroupDeletePrefix("");
      loadData();
    } catch (error) {
      toast({
        title: t("error"),
        description: error instanceof Error ? error.message : t("failedToDeleteRackGroup"),
        variant: "destructive",
      });
    }
  };

  const handleMultiDelete = async () => {
    try {
      if (selectedRacks.size === 0) {
        toast({
          title: t("error"),
          description: t("pleaseSelectRacksToDelete"),
          variant: "destructive",
        });
        return;
      }

      const promises = Array.from(selectedRacks).map(id => warehouseRackApi.delete(id));
      await Promise.all(promises);

      toast({
        title: t("success"),
        description: t("deletedSelectedRacks", { count: selectedRacks.size }),
      });

      setSelectedRacks(new Set());
      loadData();
    } catch (error) {
      toast({
        title: t("error"),
        description: error instanceof Error ? error.message : t("failedToDeleteSelectedRacks"),
        variant: "destructive",
      });
    }
  };

  const toggleRackSelection = (id: number) => {
    const newSelection = new Set(selectedRacks);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedRacks(newSelection);
  };

  const selectAllRacks = () => {
    setSelectedRacks(new Set(filteredRacks.map(rack => rack.id)));
  };

  const clearSelection = () => {
    setSelectedRacks(new Set());
  };

  const printSelectedRacks = () => {
    const selectedRackData = filteredRacks
      .filter(rack => selectedRacks.has(rack.id))
      .map(rack => ({
        rackCode: rack.rack_code,
        warehouseName: currentWarehouse?.name || t("unknown"),
        warehouseId: rack.warehouse_id,
        createdDate: new Date().toLocaleDateString()
      }));
    
    if (selectedRackData.length > 0) {
      setRacksToPrint(selectedRackData);
      setIsPrintDialogOpen(true);
    }
  };

  const printSingleRack = (rack: WarehouseRack) => {
    const rackData = {
      rackCode: rack.rack_code,
      warehouseName: currentWarehouse?.name || t("unknown"),
      warehouseId: rack.warehouse_id,
      createdDate: new Date().toLocaleDateString()
    };
    
    setRacksToPrint([rackData]);
    setIsPrintDialogOpen(true);
  };

  const openCreateDialog = () => {
    setBulkData({ rack_group: "", rack_count: "" });
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setBulkData({ rack_group: "", rack_count: "" });
  };

  const closeGroupDeleteDialog = () => {
    setIsGroupDeleteDialogOpen(false);
    setGroupDeletePrefix("");
  };

  if (!currentWarehouseId) {
    return (
      <PageTransition>
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-destructive mb-4">{t("noWarehouseSelected")}</h1>
            <p className="text-muted-foreground">
              {t("pleaseSelectWarehouseFromList")}
            </p>
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
            {/* Header */}
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{t("manageWarehouseRacks")}</h1>
              <p className="text-muted-foreground">
                {t("createAndManageRackCodesFor", { warehouseName: currentWarehouse?.name || t("thisWarehouse") })}
              </p>
            </div>

            {/* Search */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Search className="mr-2 h-4 w-4" />
                  {t("searchRacks")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={t("searchByRackCode")}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span>{t("actions")}</span>
                  {selectedRacks.size > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      {t("selected", { count: selectedRacks.size })}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
                  {/* Create Racks */}
                  <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogTrigger asChild>
                      <Button onClick={openCreateDialog}>
                        <Plus className="mr-2 h-4 w-4" />
                        {t("addRacks")}
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-md">
                      <DialogHeader>
                        <DialogTitle>{t("createWarehouseRacks")}</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label>{t("warehouse")}</Label>
                          <div className="p-2 bg-muted rounded-md">
                            <Badge variant="secondary" className="text-sm">
                              {currentWarehouse?.name || t("loading")}
                            </Badge>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="rack_group">{t("rackGroupNumber")}</Label>
                            <Input
                              id="rack_group"
                              placeholder={t("rackGroupPlaceholder")}
                              value={bulkData.rack_group}
                              onChange={(e) => setBulkData({ ...bulkData, rack_group: e.target.value })}
                            />
                          </div>
                          
                          <div className="space-y-2">
                            <Label htmlFor="rack_count">{t("numberOfRacks")}</Label>
                            <Input
                              id="rack_count"
                              type="number"
                              min={1}
                              max={26}
                              placeholder={t("numberOfRacksPlaceholder")}
                              value={bulkData.rack_count}
                              onChange={(e) => setBulkData({ ...bulkData, rack_count: e.target.value })}
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>{t("pattern")}</Label>
                            <div className="p-2 bg-muted rounded-md">
                              <div className="text-sm text-muted-foreground">
                                {t("rackPrefix")}{bulkData.rack_group || t("placeholderX")}{getAssignedLetters()[0] || t("defaultStartLetter")}{t("lowerLevelSuffix")}{t("commaSeparator")} {t("rackPrefix")}{bulkData.rack_group || t("placeholderX")}{getAssignedLetters()[0] || t("defaultStartLetter")}{t("upperLevelSuffix")}{t("commaSeparator")} {t("ellipsis")}
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {t("alwaysCreatesBothLevels")}
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {t("lettersAutoAssignedNote")}
                              </div>
                            </div>
                          </div>

                          {bulkData.rack_group && bulkData.rack_count && (
                            <div className="space-y-2">
                              <Label>{t("preview", { count: generateRackCodes().length })}</Label>
                              <div className="p-2 bg-muted rounded-md max-h-32 overflow-y-auto">
                                <div className="text-xs text-muted-foreground mb-1">
                                  {t("assignedLetters", { letters: getAssignedLetters().join(t("commaSeparator")) })}
                                </div>
                                <div className="text-sm font-mono">
                                  {generateRackCodes().slice(0, 10).join(t("commaSeparator"))}
                                  {generateRackCodes().length > 10 && `${t("ellipsis")} ${t("andMore", { count: generateRackCodes().length - 10 })}`}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex justify-end space-x-2">
                          <Button variant="outline" onClick={closeDialog}>
                            {t("cancel")}
                          </Button>
                          <Button onClick={handleBulkCreate}>
                            {t("createAll")}
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>

                  {/* Selection Actions */}
                  {selectedRacks.size > 0 && (
                    <>
                      <Button 
                        variant="outline" 
                        onClick={printSelectedRacks}
                      >
                        <Printer className="mr-2 h-4 w-4" />
                        {t("printSelected")}
                      </Button>
                      <Button 
                        variant="destructive" 
                        onClick={handleMultiDelete}
                      >
                        <Trash className="mr-2 h-4 w-4" />
                        {t("deleteSelected")}
                      </Button>
                    </>
                  )}

                  {/* Bulk Actions */}
                  <Dialog open={isGroupDeleteDialogOpen} onOpenChange={setIsGroupDeleteDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="destructive">
                        <Layers className="mr-2 h-4 w-4" />
                        {t("deleteGroup")}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t("deleteRackGroup")}</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="group_prefix">{t("rackGroupPrefix")}</Label>
                          <Input
                            id="group_prefix"
                            placeholder={t("rackGroupPrefixPlaceholder")}
                            value={groupDeletePrefix}
                            onChange={(e) => setGroupDeletePrefix(e.target.value.toUpperCase())}
                          />
                          <p className="text-sm text-muted-foreground">
                            {t("deleteGroupDescription")}
                            <br />
                            {t("deleteGroupExample")}
                          </p>
                        </div>
                        <div className="flex justify-end space-x-2">
                          <Button variant="outline" onClick={closeGroupDeleteDialog}>
                            {t("cancel")}
                          </Button>
                          <Button variant="destructive" onClick={handleGroupDelete}>
                            {t("deleteGroup")}
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>

                </div>
              </CardContent>
            </Card>

            {/* Racks Table */}
            <Card>
              <CardHeader>
                <CardTitle>{t("warehouseRacks", { count: filteredRacks.length })}</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-center py-8">{t("loading")}</div>
                ) : filteredRacks.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {t("noWarehouseRacksFound")}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">
                          <Checkbox
                            checked={filteredRacks.length > 0 && filteredRacks.every(rack => selectedRacks.has(rack.id))}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                selectAllRacks();
                              } else {
                                clearSelection();
                              }
                            }}
                          />
                        </TableHead>
                        <TableHead>{t("rackCode")}</TableHead>
                        <TableHead className="text-right">{t("actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRacks.map((rack) => (
                        <TableRow key={rack.id} className={selectedRacks.has(rack.id) ? "bg-muted/50" : ""}>
                          <TableCell>
                            <Checkbox
                              checked={selectedRacks.has(rack.id)}
                              onCheckedChange={() => toggleRackSelection(rack.id)}
                            />
                          </TableCell>
                          <TableCell className="font-mono">{rack.rack_code}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end space-x-2">
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => printSingleRack(rack)}
                                title={t("printLabel")}
                              >
                                <Printer className="h-4 w-4" />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="outline" size="sm">
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>{t("deleteWarehouseRack")}</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      {t("confirmDeleteRack", { rackCode: rack.rack_code })}
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDelete(rack.id)}>
                                      {t("delete")}
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
      </div>

      {/* Print Dialog */}
      <PrintDialog
        isOpen={isPrintDialogOpen}
        onClose={() => setIsPrintDialogOpen(false)}
        racks={racksToPrint}
        onPrintComplete={(success) => {
          if (success) {
            toast({
              title: t("printComplete"),
              description: t("rackLabelsPrintedSuccessfully"),
            });
          } else {
            toast({
              title: t("printFailed"),
              description: t("failedToPrintRackLabels"),
              variant: "destructive",
            });
          }
        }}
      />
    </PageTransition>
  );
};

export default ManageWarehouseRacks;
