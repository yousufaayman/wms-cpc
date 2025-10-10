import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, LogOut, Warehouse as WarehouseIcon, Layout, BarChart3, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { warehouseApi, Warehouse } from "@/lib/api";
import LanguageToggle from "./LanguageToggle";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/contexts/LanguageContext";

const Sidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const warehouseId = searchParams.get("warehouse");
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { t } = useTranslation();
  const { language } = useLanguage();

  // Determine active page
  const isDashboardActive = location.pathname === "/dashboard";
  const isManageRacksActive = location.pathname === "/manage-racks";

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  const handleLogout = () => {
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

  useEffect(() => {
    const fetchWarehouse = async () => {
      if (!warehouseId) return;
      
      try {
        setLoading(true);
        const warehouseData = await warehouseApi.getById(parseInt(warehouseId));
        setWarehouse(warehouseData);
      } catch (error) {
        console.error("Failed to fetch warehouse:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchWarehouse();
  }, [warehouseId]);

  return (
    <aside className={`${isCollapsed ? 'w-16' : 'w-64'} bg-card border-r min-h-screen p-4 flex flex-col transition-all duration-300 ease-in-out`}>
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
          variant={isManageRacksActive ? "secondary" : "ghost"}
          className={`w-full ${isCollapsed ? 'justify-center px-0' : 'justify-start'} ${isManageRacksActive ? "bg-primary/10 text-primary" : ""}`}
          onClick={handleManageRacks}
          title={isCollapsed ? t('manageWarehouseRacks') : ''}
        >
          <Layout className="h-4 w-4" />
          {!isCollapsed && <span className="ml-2">{t('manageWarehouseRacks')}</span>}
        </Button>
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
