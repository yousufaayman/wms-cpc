import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, FileText, Calendar, User, Package, CheckCircle, XCircle, Clock, Loader2 } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/contexts/LanguageContext";
import LanguageToggle from "@/components/LanguageToggle";
import { receiptApi, type Receipt } from "@/lib/api";

const ReceiptDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { t } = useTranslation();
  const { language } = useLanguage();

  useEffect(() => {
    const loadReceipt = async () => {
      if (!id) {
        setError("Receipt ID is required");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const receiptData = await receiptApi.getById(parseInt(id));
        setReceipt(receiptData);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load receipt");
      } finally {
        setLoading(false);
      }
    };

    loadReceipt();
  }, [id]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'confirmed':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'cancelled':
        return <XCircle className="h-5 w-5 text-red-500" />;
      case 'issued':
        return <Clock className="h-5 w-5 text-yellow-500" />;
      default:
        return <Clock className="h-5 w-5 text-gray-500" />;
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'confirmed':
        return 'default';
      case 'issued':
        return 'secondary';
      case 'cancelled':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  const getTypeBadgeVariant = (type: string) => {
    switch (type) {
      case 'inbound':
        return 'default';
      case 'dyehouse':
        return 'secondary';
      case 'cutting':
        return 'outline';
      case 'shipping':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleBack = () => {
    navigate('/receipts');
  };

  if (loading) {
    return (
      <PageTransition>
        <div className={`min-h-screen bg-background ${language === 'ar' ? 'rtl' : 'ltr'}`}>
          <div className="absolute top-4 right-4">
            <LanguageToggle />
          </div>
          <div className="flex items-center justify-center h-screen">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-primary">{t('loading')}</h1>
            </div>
          </div>
        </div>
      </PageTransition>
    );
  }

  if (error || !receipt) {
    return (
      <PageTransition>
        <div className="min-h-screen bg-background flex">
          <Sidebar />
          <main className="flex-1 p-8">
            <div className="flex items-center justify-center h-screen">
              <div className="text-center">
                <FileText className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                <h1 className="text-2xl font-bold text-primary mb-2">Receipt Not Found</h1>
                <p className="text-muted-foreground mb-4">{error || "The requested receipt could not be found."}</p>
                <Button onClick={handleBack}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Receipts
                </Button>
              </div>
            </div>
          </main>
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
            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={handleBack}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Receipts
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <FileText className="h-8 w-8 text-primary" />
              <h1 className="text-3xl font-bold text-primary">Receipt #{receipt.id}</h1>
            </div>

            {/* Receipt Information */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Basic Information */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Package className="h-5 w-5" />
                    Receipt Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Receipt ID</label>
                      <p className="text-lg font-semibold">#{receipt.id}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Type</label>
                      <div className="mt-1">
                        <Badge variant={getTypeBadgeVariant(receipt.receipt_type)}>
                          {receipt.receipt_type}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Status</label>
                    <div className="flex items-center gap-2 mt-1">
                      {getStatusIcon(receipt.status)}
                      <Badge variant={getStatusBadgeVariant(receipt.status)}>
                        {receipt.status}
                      </Badge>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Closed Status</label>
                    <div className="mt-1">
                      <Badge variant={receipt.closed ? "destructive" : "default"}>
                        {receipt.closed ? "Closed" : "Open"}
                      </Badge>
                    </div>
                  </div>

                  {receipt.reference_receipt_id && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Reference Receipt</label>
                      <div className="mt-1">
                        <Badge variant="secondary">
                          Receipt #{receipt.reference_receipt_id}
                        </Badge>
                      </div>
                    </div>
                  )}

                  {receipt.source_location_id && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Source Location</label>
                      <p className="text-lg">Location #{receipt.source_location_id}</p>
                    </div>
                  )}

                  {receipt.target_location_id && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Target Location</label>
                      <p className="text-lg">Location #{receipt.target_location_id}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Timeline Information */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    Timeline
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Issued By</label>
                    <div className="flex items-center gap-2 mt-1">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span>User #{receipt.issued_by}</span>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Issued At</label>
                    <div className="flex items-center gap-2 mt-1">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span>{formatDate(receipt.issued_at)}</span>
                    </div>
                  </div>

                  {receipt.confirmed_by && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Confirmed By</label>
                      <div className="flex items-center gap-2 mt-1">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span>User #{receipt.confirmed_by}</span>
                      </div>
                    </div>
                  )}

                  {receipt.confirmed_at && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Confirmed At</label>
                      <div className="flex items-center gap-2 mt-1">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span>{formatDate(receipt.confirmed_at)}</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Receipt Items - Placeholder for future implementation */}
            <Card>
              <CardHeader>
                <CardTitle>Receipt Items</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Receipt items functionality will be implemented in a future update.</p>
                  <p className="text-sm">This will show the boxes, rolls, and other items associated with this receipt.</p>
                </div>
              </CardContent>
            </Card>

            {/* Actions */}
            <Card>
              <CardHeader>
                <CardTitle>Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleBack}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Receipts
                  </Button>
                  {receipt.status === 'issued' && (
                    <>
                      <Button variant="default">
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Confirm Receipt
                      </Button>
                      <Button variant="destructive">
                        <XCircle className="h-4 w-4 mr-2" />
                        Cancel Receipt
                      </Button>
                    </>
                  )}
                  {!receipt.closed ? (
                    <Button variant="destructive">
                      <XCircle className="h-4 w-4 mr-2" />
                      Close Receipt
                    </Button>
                  ) : (
                    <Button variant="default">
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Open Receipt
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </PageTransition>
  );
};

export default ReceiptDetail;
