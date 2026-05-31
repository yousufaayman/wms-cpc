import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, LogOut, Warehouse as WarehouseIcon, Layout, BarChart3, ChevronLeft, ChevronRight, FileText, Scissors, Layers, PackageOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { warehouseApi, Warehouse } from "@/lib/api";
import LanguageToggle from "./LanguageToggle";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/contexts/LanguageContext";
import { clearToken } from "@/lib/auth";

const Sidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const warehouseId = searchParams.get("warehouse");
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(() => window.innerWidth < 1024);
  const { t } = useTranslation();
  useLanguage();

  // Determine active page
  const isDashboardActive = location.pathname === "/dashboard";
  const isManageRacksActive = location.pathname === "/manage-racks";
  const isReceiptsActive = location.pathname.startsWith("/receipts");
  const isFabricRollsActive = location.pathname === "/fabric-rolls";
  const isUndyedFabricRollsActive = location.pathname === "/undyed-fabric-rolls";
  const isFabricInventoryActive = location.pathname === "/fabric-inventory";
  const isExpectedDeliveriesActive = location.pathname.startsWith("/expected-deliveries");

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

  const handleDashboard = () => {
    navigate(`/dashboard?warehouse=${warehouseId}`);
  };

  const handleManageRacks = () => {
    navigate(`/manage-racks?warehouse=${warehouseId}`);
  };

  const handleReceipts = () => {
    navigate(`/receipts?warehouse=${warehouseId}`);
  };

  const handleFabricRolls = () => {
    navigate(`/fabric-rolls?warehouse=${warehouseId}`);
  };

  const handleUndyedFabricRolls = () => {
    navigate(`/undyed-fabric-rolls?warehouse=${warehouseId}`);
  };

  const handleFabricInventory = () => {
    navigate(`/fabric-inventory?warehouse=${warehouseId}`);
  };

  const handleExpectedDeliveries = () => {
    navigate(`/expected-deliveries?warehouse=${warehouseId}`);
  };

  useEffect(() => {
    if (!warehouseId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    warehouseApi.getById(parseInt(warehouseId))
      .then(setWarehouse)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [warehouseId]);

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
        <Button
          variant={isDashboardActive ? "secondary" : "ghost"}
          className={`w-full ${isCollapsed ? 'justify-center px-0' : 'justify-start'} ${isDashboardActive ? "bg-primary/10 text-primary" : ""}`}
          onClick={handleDashboard}
          title={isCollapsed ? t('dashboard') : ''}
        >
          <BarChart3 className="h-4 w-4" />
          {!isCollapsed && <span className="ml-2">{t('dashboard')}</span>}
        </Button>
        <Button
          variant={isFabricInventoryActive ? "secondary" : "ghost"}
          className={`w-full ${isCollapsed ? 'justify-center px-0' : 'justify-start'} ${isFabricInventoryActive ? "bg-primary/10 text-primary" : ""}`}
          onClick={handleFabricInventory}
          title={isCollapsed ? t('fabricInventory') : ''}
        >
          <Layers className="h-4 w-4" />
          {!isCollapsed && <span className="ml-2">{t('fabricInventory')}</span>}
        </Button>
        <Button
          variant={isReceiptsActive ? "secondary" : "ghost"}
          className={`w-full ${isCollapsed ? 'justify-center px-0' : 'justify-start'} ${isReceiptsActive ? "bg-primary/10 text-primary" : ""}`}
          onClick={handleReceipts}
          title={isCollapsed ? t('receipts') : ''}
        >
          <FileText className="h-4 w-4" />
          {!isCollapsed && <span className="ml-2">{t('receipts')}</span>}
        </Button>
        <Button
          variant={isExpectedDeliveriesActive ? "secondary" : "ghost"}
          className={`w-full ${isCollapsed ? 'justify-center px-0' : 'justify-start'} ${isExpectedDeliveriesActive ? "bg-primary/10 text-primary" : ""}`}
          onClick={handleExpectedDeliveries}
          title={isCollapsed ? t('expectedDeliveries') : ''}
        >
          <PackageOpen className="h-4 w-4" />
          {!isCollapsed && <span className="ml-2">{t('expectedDeliveries')}</span>}
        </Button>
        {warehouse?.type === 'Fabric' && (
          <>
            <Button
              variant={isFabricRollsActive ? "secondary" : "ghost"}
              className={`w-full ${isCollapsed ? 'justify-center px-0' : 'justify-start'} ${isFabricRollsActive ? "bg-primary/10 text-primary" : ""}`}
              onClick={handleFabricRolls}
              title={isCollapsed ? t('dyedFabricRolls') : ''}
            >
              <Scissors className="h-4 w-4" />
              {!isCollapsed && <span className="ml-2">{t('dyedFabricRolls')}</span>}
            </Button>
            <Button
              variant={isUndyedFabricRollsActive ? "secondary" : "ghost"}
              className={`w-full ${isCollapsed ? 'justify-center px-0' : 'justify-start'} ${isUndyedFabricRollsActive ? "bg-primary/10 text-primary" : ""}`}
              onClick={handleUndyedFabricRolls}
              title={isCollapsed ? t('undyedFabricRolls') : ''}
            >
              <Scissors className="h-4 w-4" />
              {!isCollapsed && <span className="ml-2">{t('undyedFabricRolls')}</span>}
            </Button>
          </>
        )}
      </div>

      {/* Administrative section */}
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
          <Button
            variant={isManageRacksActive ? "secondary" : "ghost"}
            className={`w-full ${isCollapsed ? 'justify-center px-0' : 'justify-start'} ${isManageRacksActive ? "bg-primary/10 text-primary" : ""}`}
            onClick={handleManageRacks}
            title={isCollapsed ? t('manageWarehouseRacks') : ''}
          >
            <Layout className="h-4 w-4" />
            {!isCollapsed && <span className="ml-2">{t('manageWarehouseRacks')}</span>}
          </Button>
        </div>
      </div>

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
