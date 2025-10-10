import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Loader2, Package, Shirt, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { warehouseApi, Warehouse, WarehouseType } from "@/lib/api";
import PageTransition from "@/components/PageTransition";

const Warehouses = () => {
  const navigate = useNavigate();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [navigating, setNavigating] = useState<number | null>(null);

  // Helper function to get warehouse type icon
  const getWarehouseTypeIcon = (type: WarehouseType) => {
    switch (type) {
      case 'Fabric':
        return <Package className="h-4 w-4" />;
      case 'RMG':
        return <Shirt className="h-4 w-4" />;
      case 'Accessory':
        return <Zap className="h-4 w-4" />;
      default:
        return <Package className="h-4 w-4" />;
    }
  };

  // Helper function to get warehouse type badge variant
  const getWarehouseTypeBadgeVariant = (type: WarehouseType) => {
    switch (type) {
      case 'Fabric':
        return 'default';
      case 'RMG':
        return 'secondary';
      case 'Accessory':
        return 'outline';
      default:
        return 'default';
    }
  };

  useEffect(() => {
    const fetchWarehouses = async () => {
      try {
        setLoading(true);
        const data = await warehouseApi.getAll();
        setWarehouses(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch warehouses");
      } finally {
        setLoading(false);
      }
    };

    fetchWarehouses();
  }, []);

  const handleSelectWarehouse = (warehouseId: number) => {
    setNavigating(warehouseId);
    // Add a small delay to show the loading state before navigation
    setTimeout(() => {
      navigate(`/dashboard?warehouse=${warehouseId}`);
    }, 300);
  };

  if (loading) {
    return (
      <PageTransition>
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-primary mb-4">Loading Warehouses...</h1>
          </div>
        </div>
      </PageTransition>
    );
  }

  if (error) {
    return (
      <PageTransition>
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-primary mb-4">Error Loading Warehouses</h1>
            <p className="text-muted-foreground">{error}</p>
          </div>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="min-h-screen bg-background flex items-center justify-center">
      <div className={`w-full mx-auto px-4 ${
        warehouses.length <= 2 ? 'max-w-4xl' : 
        warehouses.length <= 4 ? 'max-w-5xl' : 
        'max-w-7xl'
      }`}>
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-primary mb-4">Select Warehouse</h1>
          <Button 
            variant="outline" 
            size="lg"
            className="mt-4 hover:bg-primary hover:text-primary-foreground transition-all duration-300"
          >
            Warehouse Management
          </Button>
        </div>

        <div className="flex justify-center">
          <div className={`grid gap-8 justify-items-center ${
            warehouses.length === 1 
              ? 'grid-cols-1' 
              : warehouses.length === 2 
                ? 'grid-cols-1 md:grid-cols-2' 
                : warehouses.length === 3 
                  ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
                  : warehouses.length === 4
                    ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4'
                    : warehouses.length <= 6
                      ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3'
                      : warehouses.length <= 9
                        ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
                        : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'
          }`}>
          {warehouses.map((warehouse) => (
            <Card
              key={warehouse.id}
              className={`hover:shadow-2xl hover:scale-105 hover:-translate-y-2 transition-all duration-300 ease-in-out cursor-pointer group border-2 hover:border-primary/20 w-full max-w-xs min-w-[280px] ${
                navigating === warehouse.id ? 'opacity-75 pointer-events-none' : ''
              }`}
              onClick={() => !navigating && handleSelectWarehouse(warehouse.id)}
            >
              <CardHeader className="text-center pb-4">
                <CardTitle className="text-primary group-hover:text-primary/80 transition-colors duration-300">{warehouse.name}</CardTitle>
                <Badge 
                  variant={getWarehouseTypeBadgeVariant(warehouse.type) as any}
                  className="mt-2 inline-flex items-center gap-1"
                >
                  {getWarehouseTypeIcon(warehouse.type)}
                  {warehouse.type}
                </Badge>
              </CardHeader>
              <CardContent>
                <div className="flex justify-center pt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="group-hover:text-primary group-hover:bg-primary/10 transition-all duration-300 hover:scale-110"
                    disabled={navigating === warehouse.id}
                  >
                    {navigating === warehouse.id ? (
                      <>
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        Select
                        <ArrowRight className="ml-1 h-4 w-4 group-hover:translate-x-1 transition-transform duration-300" />
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          </div>
        </div>
      </div>
      </div>
    </PageTransition>
  );
};

export default Warehouses;
