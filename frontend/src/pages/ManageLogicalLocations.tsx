import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Search, Pencil, MapPin } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { logicalLocationApi, LogicalLocation, LogicalLocationType } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";

interface LocationFormState {
  name: string;
  location_type: LogicalLocationType;
  contact_name: string;
  contact_number: string;
  supplier_type: string;
}

const emptyForm: LocationFormState = {
  name: "",
  location_type: "internal",
  contact_name: "",
  contact_number: "",
  supplier_type: "",
};

const ManageLogicalLocations = () => {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [locations, setLocations] = useState<LogicalLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<LocationFormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await logicalLocationApi.getAll({ limit: 500 });
      setLocations(data);
    } catch (error) {
      toast({
        title: t("error"),
        description: t("failedToLoadLogicalLocations"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredLocations = locations.filter((location) =>
    location.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const openCreateDialog = () => {
    setEditingId(null);
    setForm(emptyForm);
    setIsDialogOpen(true);
  };

  const openEditDialog = (location: LogicalLocation) => {
    setEditingId(location.id);
    setForm({
      name: location.name,
      location_type: location.location_type ?? "internal",
      contact_name: location.contact_name ?? "",
      contact_number: location.contact_number ?? "",
      supplier_type: location.supplier_type ?? "",
    });
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({
        title: t("error"),
        description: t("pleaseEnterLocationName"),
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      // Send explicit values (including "") rather than omitting cleared
      // fields — the backend update only touches keys present in the
      // request body, so an omitted key would leave a stale value in place.
      const payload = {
        name: form.name.trim(),
        location_type: form.location_type,
        contact_name: form.contact_name.trim(),
        contact_number: form.contact_number.trim(),
        supplier_type: form.location_type === "supplier" ? form.supplier_type.trim() : "",
      };

      if (editingId != null) {
        await logicalLocationApi.update(editingId, payload);
        toast({ title: t("success"), description: t("logicalLocationUpdatedSuccessfully") });
      } else {
        await logicalLocationApi.create(payload);
        toast({ title: t("success"), description: t("logicalLocationCreatedSuccessfully") });
      }

      closeDialog();
      loadData();
    } catch (error) {
      toast({
        title: t("error"),
        description: error instanceof Error
          ? error.message
          : t(editingId != null ? "failedToUpdateLogicalLocation" : "failedToCreateLogicalLocation"),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (location: LogicalLocation) => {
    try {
      await logicalLocationApi.delete(location.id);
      toast({ title: t("success"), description: t("logicalLocationDeletedSuccessfully") });
      loadData();
    } catch (error) {
      toast({
        title: t("error"),
        description: error instanceof Error ? error.message : t("failedToDeleteLogicalLocation"),
        variant: "destructive",
      });
    }
  };

  return (
    <PageTransition>
      <div className="min-h-screen bg-background flex">
        <Sidebar />
        <main className="flex-1 p-8">
          <div className="space-y-6">
            {/* Header */}
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{t("manageLogicalLocations")}</h1>
              <p className="text-muted-foreground">{t("manageLogicalLocationsDesc")}</p>
            </div>

            {/* Search */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Search className="mr-2 h-4 w-4" />
                  {t("searchLogicalLocations")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={t("searchByLocationName")}
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
                <CardTitle>{t("actions")}</CardTitle>
              </CardHeader>
              <CardContent>
                <Dialog open={isDialogOpen} onOpenChange={(open) => (open ? openCreateDialog() : closeDialog())}>
                  <DialogTrigger asChild>
                    <Button onClick={openCreateDialog}>
                      <Plus className="mr-2 h-4 w-4" />
                      {t("addLogicalLocation")}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>{editingId != null ? t("editLogicalLocation") : t("createLogicalLocation")}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="location_name">{t("locationName")}</Label>
                        <Input
                          id="location_name"
                          placeholder={t("locationNamePlaceholder")}
                          value={form.name}
                          onChange={(e) => setForm({ ...form, name: e.target.value })}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>{t("locationTypeLabel")}</Label>
                        <Select
                          value={form.location_type}
                          onValueChange={(value: LogicalLocationType) => setForm({ ...form, location_type: value })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="internal">{t("internalType")}</SelectItem>
                            <SelectItem value="supplier">{t("supplier")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {form.location_type === "supplier" && (
                        <div className="space-y-2">
                          <Label htmlFor="supplier_type">{t("supplierTypeLabel")}</Label>
                          <Input
                            id="supplier_type"
                            placeholder={t("supplierTypePlaceholder")}
                            value={form.supplier_type}
                            onChange={(e) => setForm({ ...form, supplier_type: e.target.value })}
                          />
                        </div>
                      )}

                      <div className="space-y-2">
                        <Label htmlFor="contact_name">{t("contactNameLabel")}</Label>
                        <Input
                          id="contact_name"
                          placeholder={t("optionalField")}
                          value={form.contact_name}
                          onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="contact_number">{t("contactNumberLabel")}</Label>
                        <Input
                          id="contact_number"
                          placeholder={t("optionalField")}
                          value={form.contact_number}
                          onChange={(e) => setForm({ ...form, contact_number: e.target.value })}
                        />
                      </div>

                      <div className="flex justify-end space-x-2">
                        <Button variant="outline" onClick={closeDialog}>
                          {t("cancel")}
                        </Button>
                        <Button onClick={handleSave} disabled={saving}>
                          {editingId != null ? t("saveChanges") : t("create")}
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>

            {/* Locations Table */}
            <Card>
              <CardHeader>
                <CardTitle>{t("logicalLocationsCount", { count: filteredLocations.length })}</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-center py-8">{t("loading")}</div>
                ) : filteredLocations.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {t("noLogicalLocationsFound")}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("locationName")}</TableHead>
                        <TableHead>{t("locationTypeLabel")}</TableHead>
                        <TableHead>{t("contactNameLabel")}</TableHead>
                        <TableHead>{t("contactNumberLabel")}</TableHead>
                        <TableHead className="text-right">{t("actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLocations.map((location) => (
                        <TableRow key={location.id}>
                          <TableCell className="font-medium flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                            {location.name}
                          </TableCell>
                          <TableCell>
                            <Badge variant={location.location_type === "supplier" ? "secondary" : "outline"}>
                              {location.location_type === "supplier" ? t("supplier") : t("internalType")}
                            </Badge>
                          </TableCell>
                          <TableCell>{location.contact_name || "—"}</TableCell>
                          <TableCell>{location.contact_number || "—"}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end space-x-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openEditDialog(location)}
                                title={t("editLogicalLocation")}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="outline" size="sm">
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>{t("deleteLogicalLocation")}</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      {t("confirmDeleteLogicalLocation", { name: location.name })}
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDelete(location)}>
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
    </PageTransition>
  );
};

export default ManageLogicalLocations;
