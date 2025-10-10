import { useSearchParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, TrendingUp, AlertCircle, BarChart3, LogOut, ArrowLeft } from "lucide-react";

const Dashboard = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const warehouseId = searchParams.get("warehouse") || "wh-001";

  const stats = [
    {
      title: "Total Items",
      value: "12,482",
      change: "+12% from last month",
      icon: Package,
      color: "text-primary",
    },
    {
      title: "Low Stock Items",
      value: "23",
      change: "Requires attention",
      icon: AlertCircle,
      color: "text-destructive",
    },
    {
      title: "Orders Today",
      value: "145",
      change: "+8% from yesterday",
      icon: TrendingUp,
      color: "text-secondary",
    },
    {
      title: "Capacity Used",
      value: "78%",
      change: "22% available",
      icon: BarChart3,
      color: "text-accent-foreground",
    },
  ];

  const handleLogout = () => {
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/warehouses")}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Warehouses
            </Button>
            <div>
              <h1 className="text-xl font-bold text-primary">Warehouse Dashboard</h1>
              <p className="text-sm text-muted-foreground">ID: {warehouseId}</p>
            </div>
          </div>
          <Button variant="outline" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-primary mb-2">Overview</h2>
          <p className="text-muted-foreground">
            Real-time inventory and operational metrics
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {stats.map((stat, index) => (
            <Card key={index}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {stat.title}
                </CardTitle>
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {stat.change}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-primary">Recent Activity</CardTitle>
              <CardDescription>Latest warehouse operations</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  { action: "Inbound shipment", items: "250 units", time: "2 hours ago" },
                  { action: "Order fulfilled", items: "145 units", time: "4 hours ago" },
                  { action: "Inventory check", items: "Complete", time: "6 hours ago" },
                  { action: "Stock replenished", items: "500 units", time: "1 day ago" },
                ].map((activity, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <div>
                      <p className="font-medium">{activity.action}</p>
                      <p className="text-sm text-muted-foreground">{activity.items}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">{activity.time}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-primary">Quick Actions</CardTitle>
              <CardDescription>Common warehouse tasks</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button className="w-full justify-start" variant="secondary">
                <Package className="mr-2 h-4 w-4" />
                Process Inbound Shipment
              </Button>
              <Button className="w-full justify-start" variant="outline">
                <TrendingUp className="mr-2 h-4 w-4" />
                Create Order
              </Button>
              <Button className="w-full justify-start" variant="outline">
                <BarChart3 className="mr-2 h-4 w-4" />
                Generate Report
              </Button>
              <Button className="w-full justify-start" variant="outline">
                <AlertCircle className="mr-2 h-4 w-4" />
                View Alerts
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
