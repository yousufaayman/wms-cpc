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
import { LanguageProvider } from "./contexts/LanguageContext";

// Lazy load Dashboard component
const Dashboard = lazy(() => import("./pages/Dashboard"));
const ManageWarehouseRacks = lazy(() => import("./pages/ManageWarehouseRacks"));

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
            <Route path="/warehouses" element={<Warehouses />} />
            <Route 
              path="/dashboard" 
              element={
                <Suspense fallback={<LoadingSpinner message="Loading Dashboard..." />}>
                  <Dashboard />
                </Suspense>
              } 
            />
            <Route 
              path="/manage-racks" 
              element={
                <Suspense fallback={<LoadingSpinner message="Loading Manage Racks..." />}>
                  <ManageWarehouseRacks />
                </Suspense>
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
