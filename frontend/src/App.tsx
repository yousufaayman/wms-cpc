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
import { LanguageProvider } from "./contexts/LanguageContext";

// Lazy load Dashboard component
const Dashboard = lazy(() => import("./pages/Dashboard"));
const ManageWarehouseRacks = lazy(() => import("./pages/ManageWarehouseRacks"));
const Receipts = lazy(() => import("./pages/Receipts"));
const ReceiptDetail = lazy(() => import("./pages/ReceiptDetail"));
const CreateReceipt = lazy(() => import("./pages/CreateReceipt"));
const FabricRolls = lazy(() => import("./pages/FabricRolls"));
const FabricInventory = lazy(() => import("./pages/FabricInventory"));
const UndyedFabricRolls = lazy(() => import("./pages/UndyedFabricRolls"));
const ExpectedDeliveries = lazy(() => import("./pages/ExpectedDeliveries"));
const ExpectedDeliveryDetail = lazy(() => import("./pages/ExpectedDeliveryDetail"));

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
                  <Suspense fallback={<LoadingSpinner message="Loading Dashboard..." />}>
                    <Dashboard />
                  </Suspense>
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/manage-racks" 
              element={
                <ProtectedRoute>
                  <Suspense fallback={<LoadingSpinner message="Loading Manage Racks..." />}>
                    <ManageWarehouseRacks />
                  </Suspense>
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
                  <Suspense fallback={<LoadingSpinner message="Loading..." />}>
                    <CreateReceipt />
                  </Suspense>
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
                  <Suspense fallback={<LoadingSpinner message="Loading Fabric Rolls..." />}>
                    <FabricRolls />
                  </Suspense>
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
                  <Suspense fallback={<LoadingSpinner message="Loading Undyed Fabric Rolls..." />}>
                    <UndyedFabricRolls />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="/expected-deliveries"
              element={
                <ProtectedRoute>
                  <Suspense fallback={<LoadingSpinner message="Loading Expected Deliveries..." />}>
                    <ExpectedDeliveries />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="/expected-deliveries/:id"
              element={
                <ProtectedRoute>
                  <Suspense fallback={<LoadingSpinner message="Loading Delivery..." />}>
                    <ExpectedDeliveryDetail />
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
