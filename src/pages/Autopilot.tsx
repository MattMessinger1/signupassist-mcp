import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, CalendarDays, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Header } from "@/components/Header";
import { PreparePlanSheet } from "@/components/PreparePlanSheet";
import { useAuth } from "@/contexts/AuthContext";
import { buildAutopilotIntentPath } from "@/lib/signupIntent";

export default function Autopilot() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading } = useAuth();
  const intentId = searchParams.get("intent");
  const returnPath = intentId ? buildAutopilotIntentPath(intentId) : "/run-center";

  useEffect(() => {
    if (!loading && !user) {
      navigate(`/auth?returnTo=${encodeURIComponent(returnPath)}`);
    }
  }, [loading, navigate, returnPath, user]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        {intentId ? (
          <div className="space-y-6">
            <Button variant="ghost" onClick={() => navigate("/activity-finder")}>
              <ArrowLeft className="h-4 w-4" />
              Back to Find Activity
            </Button>
            <div className="mx-auto max-w-3xl text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--secondary))] text-primary">
                <CalendarDays className="h-6 w-6" />
              </div>
              <h1 className="text-3xl font-bold tracking-normal text-primary">Prepare your signup plan</h1>
              <p className="mt-2 text-muted-foreground">
                Review the essentials, save the plan, then launch the helper when the signup window opens.
              </p>
            </div>
            <PreparePlanSheet intentId={intentId} variant="card" returnPath={returnPath} />
          </div>
        ) : (
          <Card className="mx-auto max-w-2xl">
            <CardHeader>
              <CardTitle className="text-2xl">Start from Find Activity</CardTitle>
              <CardDescription>
                Search for an activity, choose a result, and SignupAssist will prepare the plan from a secure signup intent.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row">
              <Button onClick={() => navigate("/activity-finder")}>
                <Search className="h-4 w-4" />
                Find Activity
              </Button>
              <Button variant="outline" onClick={() => navigate("/run-center")}>
                View Run Center
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
