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
import RegistrationDashboard from "./pages/RegistrationDashboard";
import Autopilot from "./pages/Autopilot";
import ActivityFinder from "./pages/ActivityFinder";
import DiscoveryRuns from "./pages/DiscoveryRuns";
import MandatesAudit from "./pages/MandatesAudit";
import FlowTester from "./pages/FlowTester";
import NotFound from "./pages/NotFound";
import { DisambiguationDemo } from "./components/DisambiguationDemo";
import ChatTestHarness from "./pages/ChatTestHarness";
import MCPChatTest from "./pages/MCPChatTest";
import AdminConsole from "./pages/admin/AdminConsole";
import SignupAssistMockups from "./pages/SignupAssistMockups";

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
            <Route path="/activity-finder" element={<ActivityFinder />} />
            <Route path="/autopilot" element={<Autopilot />} />
            <Route path="/plan-builder" element={<PlanBuilderWithStripe />} />
            <Route path="/credentials" element={<Credentials />} />
            <Route path="/discovery-runs" element={<DiscoveryRuns />} />
            <Route path="/mandates" element={<MandatesAudit />} />
            <Route path="/admin" element={<AdminConsole />} />
            <Route path="/flow-test" element={<FlowTester />} />
            <Route path="/disambiguation-demo" element={<DisambiguationDemo />} />
            <Route path="/chat-test" element={<ChatTestHarness />} />
            <Route path="/mcp-chat-test" element={<MCPChatTest />} />
            <Route path="/mockups/signupassist" element={<SignupAssistMockups />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
