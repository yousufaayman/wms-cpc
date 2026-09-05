import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ArrowLeft, Plus, Users as UsersIcon } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import LanguageToggle from "@/components/LanguageToggle";
import { useTranslation } from "@/hooks/useTranslation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useToast } from "@/hooks/use-toast";
import { userApi, User, userRoleApi, UserRole, WmsRole, WMS_SYSTEM_ID } from "@/lib/api";

const WMS_ROLE_OPTIONS: { value: WmsRole; labelKey: "roleAdmin" | "roleGenOps" | "roleWManager" | "roleWWorker" | "roleViewer" }[] = [
  { value: "admin", labelKey: "roleAdmin" },
  { value: "gen_ops", labelKey: "roleGenOps" },
  { value: "W_Manager", labelKey: "roleWManager" },
  { value: "W_Worker", labelKey: "roleWWorker" },
  { value: "Viewer", labelKey: "roleViewer" },
];

const UNASSIGNED = "unassigned";

const UserManagement = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user: currentUser, isAdmin, loading: currentUserLoading } = useCurrentUser();

  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<number | null>(null);

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newConfirmPassword, setNewConfirmPassword] = useState("");
  const [newRole, setNewRole] = useState<string>(UNASSIGNED);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!currentUserLoading && !isAdmin) {
      navigate("/warehouses");
    }
  }, [currentUserLoading, isAdmin, navigate]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [usersData, rolesData] = await Promise.all([
        userApi.getAll(),
        userRoleApi.getBySystem(WMS_SYSTEM_ID),
      ]);
      setUsers(usersData);
      setRoles(rolesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToLoadUsers"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      loadData();
    }
  }, [isAdmin]);

  const roleByUserId = new Map(roles.map((r) => [r.user_id, r]));

  const handleRoleChange = async (targetUser: User, newValue: string) => {
    const existing = roleByUserId.get(targetUser.id);
    if (existing && newValue === existing.role) return;

    setSavingUserId(targetUser.id);
    try {
      if (newValue === UNASSIGNED) {
        if (existing) {
          await userRoleApi.delete(existing.id);
        }
        toast({ title: t("success"), description: t("roleRemoved", { username: targetUser.username }) });
      } else if (existing) {
        await userRoleApi.update(existing.id, newValue as WmsRole);
        toast({ title: t("success"), description: t("roleUpdated", { username: targetUser.username }) });
      } else {
        await userRoleApi.create({ user_id: targetUser.id, system_id: WMS_SYSTEM_ID, role: newValue as WmsRole });
        toast({ title: t("success"), description: t("roleUpdated", { username: targetUser.username }) });
      }
      await loadData();
    } catch (err) {
      toast({
        title: t("error"),
        description: err instanceof Error ? err.message : t("failedToUpdateRole"),
        variant: "destructive",
      });
    } finally {
      setSavingUserId(null);
    }
  };

  const resetAddForm = () => {
    setNewUsername("");
    setNewPassword("");
    setNewConfirmPassword("");
    setNewRole(UNASSIGNED);
  };

  const handleCreateUser = async () => {
    const username = newUsername.trim();
    if (!username) {
      toast({ title: t("error"), description: t("usernameRequired"), variant: "destructive" });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: t("error"), description: t("passwordTooShort"), variant: "destructive" });
      return;
    }
    if (newPassword !== newConfirmPassword) {
      toast({ title: t("error"), description: t("passwordsDoNotMatch"), variant: "destructive" });
      return;
    }

    setCreating(true);
    try {
      const created = await userApi.create({ username, password: newPassword });
      if (newRole !== UNASSIGNED) {
        await userRoleApi.create({ user_id: created.id, system_id: WMS_SYSTEM_ID, role: newRole as WmsRole });
      }
      toast({ title: t("success"), description: t("userCreated", { username }) });
      setIsAddDialogOpen(false);
      resetAddForm();
      await loadData();
    } catch (err) {
      toast({
        title: t("error"),
        description: err instanceof Error ? err.message : t("failedToCreateUser"),
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  if (currentUserLoading || (!isAdmin && !currentUserLoading)) {
    return (
      <PageTransition>
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center text-muted-foreground">{t("loading")}</div>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="flex items-center justify-between mb-8">
            <Button variant="ghost" onClick={() => navigate("/warehouses")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("backToWarehouses")}
            </Button>
            <LanguageToggle />
          </div>

          <div className="mb-6">
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <UsersIcon className="h-7 w-7 text-primary" />
              {t("userManagement")}
            </h1>
            <p className="text-muted-foreground mt-1">{t("userManagementDescription")}</p>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>{t("users")}</CardTitle>
              <Dialog open={isAddDialogOpen} onOpenChange={(open) => { setIsAddDialogOpen(open); if (!open) resetAddForm(); }}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="mr-2 h-4 w-4" />
                    {t("addUser")}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>{t("addUser")}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="new_username">{t("username")}</Label>
                      <Input
                        id="new_username"
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="new_password">{t("password")}</Label>
                      <Input
                        id="new_password"
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="new_confirm_password">{t("confirmPassword")}</Label>
                      <Input
                        id="new_confirm_password"
                        type="password"
                        value={newConfirmPassword}
                        onChange={(e) => setNewConfirmPassword(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t("assignRole")}</Label>
                      <Select value={newRole} onValueChange={setNewRole}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNASSIGNED}>{t("unassigned")}</SelectItem>
                          {WMS_ROLE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {t(option.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex justify-end space-x-2">
                      <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} disabled={creating}>
                        {t("cancel")}
                      </Button>
                      <Button onClick={handleCreateUser} disabled={creating}>
                        {creating ? t("loading") : t("addUser")}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-8 text-muted-foreground">{t("loadingUsers")}</div>
              ) : error ? (
                <div className="text-center py-8 text-destructive">{error}</div>
              ) : users.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">{t("noUsersFound")}</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("username")}</TableHead>
                      <TableHead>{t("currentRole")}</TableHead>
                      <TableHead className="text-right">{t("assignRole")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((u) => {
                      const existing = roleByUserId.get(u.id);
                      const isSelf = u.id === currentUser?.id;
                      const roleLabelKey = WMS_ROLE_OPTIONS.find((o) => o.value === existing?.role)?.labelKey;
                      return (
                        <TableRow key={u.id}>
                          <TableCell className="font-medium">{u.username}</TableCell>
                          <TableCell>
                            {existing ? (
                              <Badge variant="secondary">{roleLabelKey ? t(roleLabelKey) : existing.role}</Badge>
                            ) : (
                              <Badge variant="outline">{t("unassigned")}</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Select
                              value={existing?.role ?? UNASSIGNED}
                              disabled={isSelf || savingUserId === u.id}
                              onValueChange={(value) => handleRoleChange(u, value)}
                            >
                              <SelectTrigger className="w-[220px] ml-auto" title={isSelf ? t("cannotChangeOwnRole") : undefined}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={UNASSIGNED}>{t("unassigned")}</SelectItem>
                                {WMS_ROLE_OPTIONS.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {t(option.labelKey)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageTransition>
  );
};

export default UserManagement;
