import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import Index from "./pages/Index";
import PlanBuilderWithStripe from "./pages/PlanBuilder";
import Auth from "./pages/auth";
import Credentials from "./pages/Credentials";
import LoginTest from "./pages/LoginTest";
import RegistrationDashboard from "./pages/RegistrationDashboard";
import DiscoveryRuns from "./pages/DiscoveryRuns";
import MandatesAudit from "./pages/MandatesAudit";
import FlowTester from "./pages/FlowTester";
import NotFound from "./pages/NotFound";
import { DisambiguationDemo } from "./components/DisambiguationDemo";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/dashboard" element={<RegistrationDashboard />} />
            <Route path="/plan-builder" element={<PlanBuilderWithStripe />} />
            <Route path="/credentials" element={<Credentials />} />
            <Route path="/discovery-runs" element={<DiscoveryRuns />} />
            <Route path="/mandates" element={<MandatesAudit />} />
            <Route path="/flow-test" element={<FlowTester />} />
            <Route path="/login-test" element={<LoginTest />} />
            <Route path="/disambiguation-demo" element={<DisambiguationDemo />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
