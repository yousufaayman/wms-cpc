import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import Login from "./pages/Login";
import Warehouses from "./pages/Warehouses";
import NotFound from "./pages/NotFound";
import LoadingSpinner from "./components/LoadingSpinner";
import ProtectedRoute from "./components/ProtectedRoute";
import RequirePermission from "./components/RequirePermission";
import RequireModule from "./components/RequireModule";
import { LanguageProvider } from "./contexts/LanguageContext";

// Lazy load Dashboard component
const Dashboard = lazy(() => import("./pages/Dashboard"));
const ManageWarehouseRacks = lazy(() => import("./pages/ManageWarehouseRacks"));
const ManageLogicalLocations = lazy(() => import("./pages/ManageLogicalLocations"));
const AccessorySetup = lazy(() => import("./pages/AccessorySetup"));
const AccessoryItems = lazy(() => import("./pages/AccessoryItems"));
const Receipts = lazy(() => import("./pages/Receipts"));
const ReceiptDetail = lazy(() => import("./pages/ReceiptDetail"));
const CreateReceipt = lazy(() => import("./pages/CreateReceipt"));
const FabricRolls = lazy(() => import("./pages/FabricRolls"));
const FabricInventory = lazy(() => import("./pages/FabricInventory"));
const UndyedFabricRolls = lazy(() => import("./pages/UndyedFabricRolls"));
const ExpectedDeliveries = lazy(() => import("./pages/ExpectedDeliveries"));
const ExpectedDeliveryDetail = lazy(() => import("./pages/ExpectedDeliveryDetail"));
const MaterialRequests = lazy(() => import("./pages/MaterialRequests"));
const Analytics = lazy(() => import("./pages/Analytics"));
const UserManagement = lazy(() => import("./pages/UserManagement"));
const ComingSoon = lazy(() => import("./pages/ComingSoon"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <LanguageProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/warehouses" element={
              <ProtectedRoute>
                <Warehouses />
              </ProtectedRoute>
            } />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <RequirePermission permission="operations">
                    <RequireModule module="dashboard">
                      <Suspense fallback={<LoadingSpinner message="Loading Dashboard..." />}>
                        <Dashboard />
                      </Suspense>
                    </RequireModule>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/manage-racks"
              element={
                <ProtectedRoute>
                  <RequirePermission permission="warehouse_racks">
                    <RequireModule module="warehouse_racks">
                      <Suspense fallback={<LoadingSpinner message="Loading Manage Racks..." />}>
                        <ManageWarehouseRacks />
                      </Suspense>
                    </RequireModule>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/accessory-setup"
              element={
                <ProtectedRoute>
                  <RequirePermission permission="manage_accessory_items">
                    <RequireModule module="accessory_items">
                      <Suspense fallback={<LoadingSpinner message="Loading..." />}>
                        <AccessorySetup />
                      </Suspense>
                    </RequireModule>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/manage-logical-locations"
              element={
                <ProtectedRoute>
                  <RequirePermission permission="logical_locations">
                    <RequireModule module="logical_locations">
                      <Suspense fallback={<LoadingSpinner message="Loading Logical Locations..." />}>
                        <ManageLogicalLocations />
                      </Suspense>
                    </RequireModule>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/receipts"
              element={
                <ProtectedRoute>
                  <RequirePermission anyRole>
                    <RequireModule module="receipts">
                      <Suspense fallback={<LoadingSpinner message="Loading Receipts..." />}>
                        <Receipts />
                      </Suspense>
                    </RequireModule>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/receipts/create/:kind"
              element={
                <ProtectedRoute>
                  <RequirePermission permission="create_receipts">
                    <RequireModule module="receipts">
                      <Suspense fallback={<LoadingSpinner message="Loading..." />}>
                        <CreateReceipt />
                      </Suspense>
                    </RequireModule>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/receipts/:kind/:id"
              element={
                <ProtectedRoute>
                  <RequirePermission anyRole>
                    <RequireModule module="receipts">
                      <Suspense fallback={<LoadingSpinner message="Loading Receipt Details..." />}>
                        <ReceiptDetail />
                      </Suspense>
                    </RequireModule>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/fabric-rolls"
              element={
                <ProtectedRoute>
                  <RequirePermission permission="ingest_fabric">
                    <RequireModule module="fabric_rolls">
                      <Suspense fallback={<LoadingSpinner message="Loading Fabric Rolls..." />}>
                        <FabricRolls />
                      </Suspense>
                    </RequireModule>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/fabric-inventory"
              element={
                <ProtectedRoute>
                  <RequirePermission anyRole>
                    <RequireModule module="fabric_inventory">
                      <Suspense fallback={<LoadingSpinner message="Loading Fabric Inventory..." />}>
                        <FabricInventory />
                      </Suspense>
                    </RequireModule>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/undyed-fabric-rolls"
              element={
                <ProtectedRoute>
                  <RequirePermission permission="ingest_fabric">
                    <RequireModule module="fabric_rolls">
                      <Suspense fallback={<LoadingSpinner message="Loading Undyed Fabric Rolls..." />}>
                        <UndyedFabricRolls />
                      </Suspense>
                    </RequireModule>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/expected-deliveries"
              element={
                <ProtectedRoute>
                  <RequirePermission permission="operations">
                    <RequireModule module="expected_deliveries">
                      <Suspense fallback={<LoadingSpinner message="Loading Expected Deliveries..." />}>
                        <ExpectedDeliveries />
                      </Suspense>
                    </RequireModule>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/expected-deliveries/:id"
              element={
                <ProtectedRoute>
                  <RequirePermission permission="operations">
                    <RequireModule module="expected_deliveries">
                      <Suspense fallback={<LoadingSpinner message="Loading Delivery..." />}>
                        <ExpectedDeliveryDetail />
                      </Suspense>
                    </RequireModule>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/material-requests"
              element={
                <ProtectedRoute>
                  <RequirePermission permission="operations">
                    <RequireModule module="material_requests">
                      <Suspense fallback={<LoadingSpinner message="Loading Material Requests..." />}>
                        <MaterialRequests />
                      </Suspense>
                    </RequireModule>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/analytics"
              element={
                <ProtectedRoute>
                  <RequirePermission permission="analytics">
                    <RequireModule module="analytics">
                      <Suspense fallback={<LoadingSpinner message="Loading Analytics..." />}>
                        <Analytics />
                      </Suspense>
                    </RequireModule>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/user-management"
              element={
                <ProtectedRoute>
                  <RequirePermission adminOnly>
                    <Suspense fallback={<LoadingSpinner message="Loading User Management..." />}>
                      <UserManagement />
                    </Suspense>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            {/* Accessory warehouse: placeholders until items 14, 17, 11 and 29 build the real pages */}
            <Route
              path="/accessory-inventory"
              element={
                <ProtectedRoute>
                  <RequirePermission anyRole>
                    <RequireModule module="accessory_inventory">
                      <Suspense fallback={<LoadingSpinner message="Loading..." />}>
                        <ComingSoon title="accessoryInventory" description="accessoryInventoryComingSoon" />
                      </Suspense>
                    </RequireModule>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/receive-packs"
              element={
                <ProtectedRoute>
                  <RequirePermission permission="receive_accessories">
                    <RequireModule module="receive_packs">
                      <Suspense fallback={<LoadingSpinner message="Loading..." />}>
                        <ComingSoon title="receivePacks" description="receivePacksComingSoon" />
                      </Suspense>
                    </RequireModule>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/accessory-items"
              element={
                <ProtectedRoute>
                  <RequirePermission anyRole>
                    <RequireModule module="accessory_items">
                      <Suspense fallback={<LoadingSpinner message="Loading..." />}>
                        <AccessoryItems />
                      </Suspense>
                    </RequireModule>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/needle-exchange"
              element={
                <ProtectedRoute>
                  <RequirePermission permission="needle_exchange">
                    <RequireModule module="needle_exchange">
                      <Suspense fallback={<LoadingSpinner message="Loading..." />}>
                        <ComingSoon title="needleExchange" description="needleExchangeComingSoon" />
                      </Suspense>
                    </RequireModule>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </LanguageProvider>
  </QueryClientProvider>
);

export default App;
