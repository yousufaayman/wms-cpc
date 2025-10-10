import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, TrendingUp, AlertCircle, BarChart3 } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/contexts/LanguageContext";

const Dashboard = () => {
  const { t } = useTranslation();
  const { language } = useLanguage();

  return (
    <PageTransition>
      <div className="min-h-screen bg-background flex">
        <Sidebar />
        <main className="flex-1 p-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-primary">{t('recentActivity')}</CardTitle>
              <CardDescription>{t('latestOperations')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  { action: t('inboundShipment'), items: `250 ${t('units')}`, time: `2 ${t('hoursAgo')}` },
                  { action: t('orderFulfilled'), items: `145 ${t('units')}`, time: `4 ${t('hoursAgo')}` },
                  { action: t('inventoryCheck'), items: t('complete'), time: `6 ${t('hoursAgo')}` },
                  { action: t('stockReplenished'), items: `500 ${t('units')}`, time: `1 ${t('dayAgo')}` },
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
              <CardTitle className="text-primary">{t('quickActions')}</CardTitle>
              <CardDescription>{t('commonTasks')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button className="w-full justify-start" variant="secondary">
                <Package className="mr-2 h-4 w-4" />
                {t('processInboundShipment')}
              </Button>
              <Button className="w-full justify-start" variant="outline">
                <TrendingUp className="mr-2 h-4 w-4" />
                {t('createOrder')}
              </Button>
              <Button className="w-full justify-start" variant="outline">
                <BarChart3 className="mr-2 h-4 w-4" />
                {t('generateReport')}
              </Button>
              <Button className="w-full justify-start" variant="outline">
                <AlertCircle className="mr-2 h-4 w-4" />
                {t('viewAlerts')}
              </Button>
            </CardContent>
          </Card>
        </div>
        </main>
      </div>
    </PageTransition>
  );
};

export default Dashboard;
