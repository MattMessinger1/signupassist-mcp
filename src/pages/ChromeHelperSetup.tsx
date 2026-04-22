import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, ChevronRight, Download, FolderOpen, Puzzle, ShieldCheck, ToggleRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Header } from "@/components/Header";
import { detectChromeHelper } from "@/lib/chromeHelperBridge";

const HELPER_READY_KEY = "signupassist:chromeHelperReady";

const setupSteps = [
  {
    title: "Download helper",
    description: "Save the SignupAssist Chrome Helper zip.",
    icon: Download,
    action: "Download helper",
    href: "/downloads/signupassist-helper-alpha.zip",
  },
  {
    title: "Open Extensions",
    description: "Go to chrome://extensions in Chrome.",
    icon: Puzzle,
    action: "Open Extensions",
    href: "chrome://extensions",
  },
  {
    title: "Turn on Developer mode",
    description: "Use the toggle in the top-right corner.",
    icon: ToggleRight,
  },
  {
    title: "Load unpacked",
    description: "Unzip the download and select the helper folder.",
    icon: FolderOpen,
  },
  {
    title: "Verify helper",
    description: "Confirm the helper is installed and ready.",
    icon: ShieldCheck,
  },
];

export default function ChromeHelperSetup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [checking, setChecking] = useState(false);
  const [ready, setReady] = useState(() => localStorage.getItem(HELPER_READY_KEY) === "true");
  const [message, setMessage] = useState<string | null>(null);
  const returnTo = useMemo(() => {
    const candidate = searchParams.get("returnTo");
    if (!candidate || !candidate.startsWith("/")) return "/run-center";
    return candidate;
  }, [searchParams]);

  useEffect(() => {
    let isMounted = true;
    detectChromeHelper(450).then((detected) => {
      if (!isMounted || !detected) return;
      localStorage.setItem(HELPER_READY_KEY, "true");
      setReady(true);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const verifyHelper = async () => {
    setChecking(true);
    setMessage(null);
    const detected = await detectChromeHelper(1200);
    setChecking(false);

    if (detected) {
      localStorage.setItem(HELPER_READY_KEY, "true");
      setReady(true);
      setMessage("Helper ready. You can return to your plan.");
    } else {
      localStorage.removeItem(HELPER_READY_KEY);
      setReady(false);
      setMessage("Helper not detected yet. Check that the unpacked extension is on, then verify again.");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(var(--secondary))] text-primary">
            <Puzzle className="h-7 w-7" />
          </div>
          <h1 className="text-3xl font-bold tracking-normal text-primary">Set up Chrome Helper</h1>
          <p className="mx-auto mt-2 max-w-xl text-muted-foreground">
            A one-time setup that lets SignupAssist launch prepared plans from your browser.
          </p>
        </div>

        <Card className="shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-lg">Install status</CardTitle>
              <Badge variant={ready ? "default" : "secondary"}>
                {ready ? "Helper ready" : "Not ready"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {setupSteps.map((step, index) => {
              const Icon = step.icon;
              return (
                <div key={step.title} className="flex items-center gap-4 border-b py-4 last:border-b-0">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold">
                    {index + 1}
                  </span>
                  <Icon className="h-5 w-5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{step.title}</p>
                    <p className="text-sm text-muted-foreground">{step.description}</p>
                  </div>
                  {step.href && step.href.startsWith("/") ? (
                    <Button variant="outline" asChild>
                      <a href={step.href} download>
                        <Download className="h-4 w-4" />
                        {step.action}
                      </a>
                    </Button>
                  ) : step.href ? (
                    <Button variant="ghost" asChild>
                      <a href={step.href}>
                        {step.action}
                        <ChevronRight className="h-4 w-4" />
                      </a>
                    </Button>
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              );
            })}

            <div className="pt-4">
              <Button className="w-full" onClick={verifyHelper} disabled={checking}>
                {checking ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <ShieldCheck className="h-4 w-4" />}
                Verify helper
              </Button>
              {message && (
                <p className={["mt-3 text-center text-sm", ready ? "text-[#2f855a]" : "text-muted-foreground"].join(" ")}>
                  {message}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {ready && (
          <div className="mt-6 rounded-lg border border-[#b9e5c7] bg-[#eaf7ef] p-4 text-[#2f855a]">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5" />
              <div>
                <p className="font-semibold">Helper ready</p>
                <p className="text-sm">Chrome Helper is installed and ready to help SignupAssist.</p>
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 text-center">
          <Button variant="ghost" onClick={() => navigate(returnTo)}>
            Return to Run Center
          </Button>
        </div>
      </main>
    </div>
  );
}
