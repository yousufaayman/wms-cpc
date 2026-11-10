import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, LogOut, Warehouse as WarehouseIcon, Layout, BarChart3, ChevronLeft, ChevronRight, FileText, Scissors, Layers, PackageOpen, ClipboardList, TrendingUp, MapPin, Boxes, PackagePlus, Tags, Syringe, Ruler, type LucideIcon } from "lucide-react";
import { useState } from "react";
import LanguageToggle from "./LanguageToggle";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/contexts/LanguageContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useWarehouse } from "@/hooks/useWarehouse";
import { clearToken } from "@/lib/auth";
import type { Permission } from "@/lib/permissions";
import type { WarehouseModule } from "@/lib/warehouseModules";
import type { TranslationKey } from "@/lib/translations";

/** One sidebar link. It shows only when the current warehouse has `module`
 * (lib/warehouseModules.ts) AND the user holds `permission` (omit it for
 * pages every WMS role may see). `exact` = active only on that exact path. */
interface NavItem {
  path: string;
  module: WarehouseModule;
  permission?: Permission;
  label: TranslationKey;
  icon: LucideIcon;
  exact?: boolean;
}

const MAIN_NAV: NavItem[] = [
  { path: "/dashboard", module: "dashboard", permission: "operations", label: "dashboard", icon: BarChart3, exact: true },
  { path: "/fabric-inventory", module: "fabric_inventory", label: "fabricInventory", icon: Layers, exact: true },
  { path: "/accessory-inventory", module: "accessory_inventory", label: "accessoryInventory", icon: Boxes, exact: true },
  { path: "/receive-packs", module: "receive_packs", permission: "receive_accessories", label: "receivePacks", icon: PackagePlus, exact: true },
  { path: "/accessory-items", module: "accessory_items", label: "accessoryItems", icon: Tags, exact: true },
  { path: "/receipts", module: "receipts", label: "receipts", icon: FileText },
  { path: "/expected-deliveries", module: "expected_deliveries", permission: "operations", label: "expectedDeliveries", icon: PackageOpen },
  { path: "/material-requests", module: "material_requests", permission: "operations", label: "materialRequests", icon: ClipboardList },
  { path: "/fabric-rolls", module: "fabric_rolls", permission: "ingest_fabric", label: "dyedFabricRolls", icon: Scissors, exact: true },
  { path: "/undyed-fabric-rolls", module: "fabric_rolls", permission: "ingest_fabric", label: "undyedFabricRolls", icon: Scissors, exact: true },
  { path: "/needle-exchange", module: "needle_exchange", permission: "needle_exchange", label: "needleExchange", icon: Syringe, exact: true },
];

const ADMIN_NAV: NavItem[] = [
  { path: "/manage-racks", module: "warehouse_racks", permission: "warehouse_racks", label: "manageWarehouseRacks", icon: Layout, exact: true },
  { path: "/accessory-setup", module: "accessory_items", permission: "manage_accessory_items", label: "unitsAndCategories", icon: Ruler, exact: true },
  { path: "/manage-logical-locations", module: "logical_locations", permission: "logical_locations", label: "manageLogicalLocations", icon: MapPin, exact: true },
  { path: "/analytics", module: "analytics", permission: "analytics", label: "analytics", icon: TrendingUp, exact: true },
];

const Sidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { warehouseId, warehouse, loading, has } = useWarehouse();
  const [isCollapsed, setIsCollapsed] = useState(() => window.innerWidth < 1024);
  const { t } = useTranslation();
  const { can } = useCurrentUser();
  useLanguage();

  const visible = (item: NavItem) => has(item.module) && (!item.permission || can(item.permission));
  const mainItems = MAIN_NAV.filter(visible);
  const adminItems = ADMIN_NAV.filter(visible);

  const isActive = (item: NavItem) =>
    item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path);

  const renderItem = (item: NavItem) => {
    const active = isActive(item);
    const Icon = item.icon;
    return (
      <Button
        key={item.path}
        variant={active ? "secondary" : "ghost"}
        className={`w-full ${isCollapsed ? 'justify-center px-0' : 'justify-start'} ${active ? "bg-primary/10 text-primary" : ""}`}
        onClick={() => navigate(`${item.path}?warehouse=${warehouseId}`)}
        title={isCollapsed ? t(item.label) : ''}
      >
        <Icon className="h-4 w-4" />
        {!isCollapsed && <span className="ml-2">{t(item.label)}</span>}
      </Button>
    );
  };

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  const handleLogout = () => {
    clearToken();
    navigate("/");
  };

  const handleBackToWarehouses = () => {
    navigate("/warehouses");
  };

  return (
    <aside className={`${isCollapsed ? 'w-16' : 'w-64'} shrink-0 bg-card border-r h-screen sticky top-0 overflow-y-auto p-4 flex flex-col transition-all duration-300 ease-in-out`}>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleCollapse}
            className="p-1 h-8 w-8"
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>
        <div className={`flex flex-col items-center text-center ${isCollapsed ? 'hidden' : ''}`}>
          <WarehouseIcon className="h-12 w-12 text-primary mb-3" />
          <h1 className="text-lg font-bold text-primary text-center">
            {loading ? t('loading') : warehouse?.name || t('warehouseDashboard')}
          </h1>
        </div>
        {isCollapsed && (
          <div className="flex justify-center">
            <WarehouseIcon className="h-8 w-8 text-primary" />
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="space-y-2">
        {mainItems.map(renderItem)}
      </div>

      {/* Administrative section — hidden when it has no visible links. */}
      {adminItems.length > 0 && (
        <div className="mt-4">
          <div className={`flex items-center gap-2 mb-2 ${isCollapsed ? 'justify-center' : ''}`}>
            <div className="flex-1 h-px bg-border" />
            {!isCollapsed && (
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                {t('administrativeSection')}
              </span>
            )}
            <div className="flex-1 h-px bg-border" />
          </div>
          <div className="space-y-2">
            {adminItems.map(renderItem)}
          </div>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1"></div>

      {/* Footer */}
      <div className="space-y-2">
        {!isCollapsed && <LanguageToggle />}
        <Button
          variant="ghost"
          className={`w-full ${isCollapsed ? 'justify-center px-0' : 'justify-start'}`}
          onClick={handleBackToWarehouses}
          title={isCollapsed ? t('backToWarehouses') : ''}
        >
          <ArrowLeft className="h-4 w-4" />
          {!isCollapsed && <span className="ml-2">{t('backToWarehouses')}</span>}
        </Button>
        <Button 
          variant="outline" 
          className={`w-full ${isCollapsed ? 'justify-center px-0' : 'justify-start'}`}
          onClick={handleLogout}
          title={isCollapsed ? t('logout') : ''}
        >
          <LogOut className="h-4 w-4" />
          {!isCollapsed && <span className="ml-2">{t('logout')}</span>}
        </Button>
      </div>
    </aside>
  );
};

export default Sidebar;
