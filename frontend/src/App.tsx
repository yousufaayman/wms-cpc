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
import { LanguageProvider } from "./contexts/LanguageContext";

// Lazy load Dashboard component
const Dashboard = lazy(() => import("./pages/Dashboard"));
const ManageWarehouseRacks = lazy(() => import("./pages/ManageWarehouseRacks"));
const ManageLogicalLocations = lazy(() => import("./pages/ManageLogicalLocations"));
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
                    <Suspense fallback={<LoadingSpinner message="Loading Dashboard..." />}>
                      <Dashboard />
                    </Suspense>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/manage-racks"
              element={
                <ProtectedRoute>
                  <RequirePermission permission="warehouse_racks">
                    <Suspense fallback={<LoadingSpinner message="Loading Manage Racks..." />}>
                      <ManageWarehouseRacks />
                    </Suspense>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/manage-logical-locations"
              element={
                <ProtectedRoute>
                  <RequirePermission permission="logical_locations">
                    <Suspense fallback={<LoadingSpinner message="Loading Logical Locations..." />}>
                      <ManageLogicalLocations />
                    </Suspense>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/receipts"
              element={
                <ProtectedRoute>
                  <Suspense fallback={<LoadingSpinner message="Loading Receipts..." />}>
                    <Receipts />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="/receipts/create/:kind"
              element={
                <ProtectedRoute>
                  <RequirePermission permission="create_receipts">
                    <Suspense fallback={<LoadingSpinner message="Loading..." />}>
                      <CreateReceipt />
                    </Suspense>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/receipts/:kind/:id"
              element={
                <ProtectedRoute>
                  <Suspense fallback={<LoadingSpinner message="Loading Receipt Details..." />}>
                    <ReceiptDetail />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="/fabric-rolls"
              element={
                <ProtectedRoute>
                  <RequirePermission permission="ingest_fabric">
                    <Suspense fallback={<LoadingSpinner message="Loading Fabric Rolls..." />}>
                      <FabricRolls />
                    </Suspense>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/fabric-inventory"
              element={
                <ProtectedRoute>
                  <Suspense fallback={<LoadingSpinner message="Loading Fabric Inventory..." />}>
                    <FabricInventory />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="/undyed-fabric-rolls"
              element={
                <ProtectedRoute>
                  <RequirePermission permission="ingest_fabric">
                    <Suspense fallback={<LoadingSpinner message="Loading Undyed Fabric Rolls..." />}>
                      <UndyedFabricRolls />
                    </Suspense>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/expected-deliveries"
              element={
                <ProtectedRoute>
                  <RequirePermission permission="operations">
                    <Suspense fallback={<LoadingSpinner message="Loading Expected Deliveries..." />}>
                      <ExpectedDeliveries />
                    </Suspense>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/expected-deliveries/:id"
              element={
                <ProtectedRoute>
                  <RequirePermission permission="operations">
                    <Suspense fallback={<LoadingSpinner message="Loading Delivery..." />}>
                      <ExpectedDeliveryDetail />
                    </Suspense>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/material-requests"
              element={
                <ProtectedRoute>
                  <RequirePermission permission="operations">
                    <Suspense fallback={<LoadingSpinner message="Loading Material Requests..." />}>
                      <MaterialRequests />
                    </Suspense>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/analytics"
              element={
                <ProtectedRoute>
                  <RequirePermission permission="analytics">
                    <Suspense fallback={<LoadingSpinner message="Loading Analytics..." />}>
                      <Analytics />
                    </Suspense>
                  </RequirePermission>
                </ProtectedRoute>
              }
            />
            <Route
              path="/user-management"
              element={
                <ProtectedRoute>
                  <Suspense fallback={<LoadingSpinner message="Loading User Management..." />}>
                    <UserManagement />
                  </Suspense>
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
