import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AuthProvider } from "./contexts/AuthContext";
import Index from "./pages/Index";
import PlanBuilderWithStripe from "./pages/PlanBuilder";
import Auth from "./pages/auth";
import Credentials from "./pages/Credentials";
import RegistrationDashboard from "./pages/RegistrationDashboard";
import Autopilot from "./pages/Autopilot";
import ActivityFinder from "./pages/ActivityFinder";
import DiscoveryRuns from "./pages/DiscoveryRuns";
import MandatesAudit from "./pages/MandatesAudit";
import NotFound from "./pages/NotFound";
import AdminConsole from "./pages/admin/AdminConsole";
import { isTestRoutesEnabled } from "./lib/featureFlags";

const FlowTester = lazy(() => import("./pages/FlowTester"));
const ChatTestHarness = lazy(() => import("./pages/ChatTestHarness"));
const MCPChatTest = lazy(() => import("./pages/MCPChatTest"));
const SignupAssistMockups = lazy(() => import("./pages/SignupAssistMockups"));
const DisambiguationDemo = lazy(() =>
  import("./components/DisambiguationDemo").then((module) => ({
    default: module.DisambiguationDemo,
  })),
);

const queryClient = new QueryClient();
const testRoutesEnabled = isTestRoutesEnabled();

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
            <Route path="/activity-finder" element={<ActivityFinder />} />
            <Route path="/autopilot" element={<Autopilot />} />
            <Route path="/plan-builder" element={<PlanBuilderWithStripe />} />
            <Route path="/credentials" element={<Credentials />} />
            <Route path="/discovery-runs" element={<DiscoveryRuns />} />
            <Route path="/mandates" element={<MandatesAudit />} />
            <Route path="/admin" element={<AdminConsole />} />
            {testRoutesEnabled && (
              <>
                <Route path="/flow-test" element={<Suspense fallback={null}><FlowTester /></Suspense>} />
                <Route path="/disambiguation-demo" element={<Suspense fallback={null}><DisambiguationDemo /></Suspense>} />
                <Route path="/chat-test" element={<Suspense fallback={null}><ChatTestHarness /></Suspense>} />
                <Route path="/mcp-chat-test" element={<Suspense fallback={null}><MCPChatTest /></Suspense>} />
                <Route path="/mockups/signupassist" element={<Suspense fallback={null}><SignupAssistMockups /></Suspense>} />
              </>
            )}
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
