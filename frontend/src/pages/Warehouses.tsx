import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, Package, Thermometer, ArrowRight } from "lucide-react";
import warehouseIcon1 from "@/assets/warehouse-icon-1.jpg";
import warehouseIcon2 from "@/assets/warehouse-icon-2.jpg";
import warehouseIcon3 from "@/assets/warehouse-icon-3.jpg";

interface Warehouse {
  id: string;
  name: string;
  location: string;
  type: string;
  capacity: string;
  status: "active" | "maintenance";
  icon: string;
}

const warehouses: Warehouse[] = [
  {
    id: "wh-001",
    name: "Main Distribution Center",
    location: "New York, NY",
    type: "General Storage",
    capacity: "50,000 sq ft",
    status: "active",
    icon: warehouseIcon1,
  },
  {
    id: "wh-002",
    name: "West Coast Hub",
    location: "Los Angeles, CA",
    type: "Distribution",
    capacity: "35,000 sq ft",
    status: "active",
    icon: warehouseIcon2,
  },
  {
    id: "wh-003",
    name: "Cold Storage Facility",
    location: "Chicago, IL",
    type: "Refrigerated",
    capacity: "25,000 sq ft",
    status: "active",
    icon: warehouseIcon3,
  },
];

const Warehouses = () => {
  const navigate = useNavigate();

  const handleSelectWarehouse = (warehouseId: string) => {
    navigate(`/dashboard?warehouse=${warehouseId}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-primary mb-2">Select Warehouse</h1>
          <p className="text-muted-foreground">
            Choose a warehouse to manage inventory and operations
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {warehouses.map((warehouse) => (
            <Card
              key={warehouse.id}
              className="hover:shadow-lg transition-shadow cursor-pointer group"
              onClick={() => handleSelectWarehouse(warehouse.id)}
            >
              <CardHeader>
                <div className="aspect-square w-full mb-4 rounded-lg overflow-hidden bg-muted">
                  <img
                    src={warehouse.icon}
                    alt={warehouse.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <CardTitle className="text-primary">{warehouse.name}</CardTitle>
                <CardDescription>{warehouse.type}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4 mr-2 text-secondary" />
                  {warehouse.location}
                </div>
                <div className="flex items-center text-sm text-muted-foreground">
                  <Package className="h-4 w-4 mr-2 text-secondary" />
                  {warehouse.capacity}
                </div>
                <div className="flex items-center justify-between pt-2">
                  <span
                    className={`text-xs font-medium px-2 py-1 rounded ${
                      warehouse.status === "active"
                        ? "bg-accent text-accent-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {warehouse.status}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="group-hover:text-primary"
                  >
                    Select
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Warehouses;
