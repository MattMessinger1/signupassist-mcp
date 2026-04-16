import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  MousePointerClick,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Header } from "@/components/Header";
import { AUTOPILOT_PRICE_LABEL } from "@/lib/subscription";
import { SUPERVISED_AUTOPILOT_BILLING_COPY } from "@/lib/autopilot/runPacket";

const parentWins = [
  {
    icon: Zap,
    title: "Move faster at open",
    description:
      "Repeated family, child, contact, and emergency fields are ready before the rush starts.",
  },
  {
    icon: ShieldCheck,
    title: "Stay in control",
    description:
      "Payment, waivers, sensitive fields, and final submit always stop for parent approval.",
  },
  {
    icon: CalendarClock,
    title: "Prepare once",
    description:
      "Run packets, price caps, and provider playbooks set up the path toward Set and Forget.",
  },
];

const paymentFacts = [
  SUPERVISED_AUTOPILOT_BILLING_COPY.membership,
  SUPERVISED_AUTOPILOT_BILLING_COPY.providerFee,
  SUPERVISED_AUTOPILOT_BILLING_COPY.noSuccessFee,
];

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main>
        <section className="border-b bg-[hsl(var(--secondary))]">
          <div className="container mx-auto grid min-h-[calc(100vh-9rem)] max-w-6xl gap-10 px-4 py-12 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center">
            <div className="space-y-7">
              <Badge variant="secondary" className="border border-primary/10 bg-background">
                Chrome desktop supervised autopilot
              </Badge>

              <div className="space-y-4">
                <h1 className="max-w-4xl text-4xl font-bold tracking-normal text-primary sm:text-5xl lg:text-6xl">
                  Move fast when registration opens.
                </h1>
                <p className="max-w-2xl text-lg text-muted-foreground sm:text-xl">
                  SignupAssist fills the tedious parts, you approve the important parts, and cancellation is always one click away.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Link to="/autopilot">
                  <Button size="lg" className="w-full sm:w-auto">
                    <Zap className="h-5 w-5" />
                    Start supervised autopilot
                  </Button>
                </Link>
                <Link to="/dashboard">
                  <Button size="lg" variant="outline" className="w-full sm:w-auto">
                    Dashboard
                    <ArrowRight className="h-5 w-5" />
                  </Button>
                </Link>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {paymentFacts.map((fact) => (
                  <div key={fact} className="rounded-lg border bg-background p-4 text-sm text-muted-foreground">
                    <CheckCircle2 className="mb-2 h-4 w-4 text-primary" />
                    {fact}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border bg-background p-5 shadow-sm">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">SignupAssist run packet</p>
                  <h2 className="mt-1 text-2xl font-bold text-primary">Saturday soccer registration</h2>
                </div>
                <Badge>{AUTOPILOT_PRICE_LABEL}</Badge>
              </div>

              <div className="space-y-3">
                {[
                  ["Provider", "ACTIVE / ActiveNet"],
                  ["Child", "Ava M."],
                  ["Target", "U8 soccer, 9am session"],
                  ["Price cap", "$250"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between rounded-lg border p-3">
                    <span className="text-sm text-muted-foreground">{label}</span>
                    <span className="text-sm font-medium">{value}</span>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-lg bg-[hsl(var(--secondary))] p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <MousePointerClick className="h-4 w-4 text-primary" />
                  Helper status
                </div>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>Known fields filled.</p>
                  <p>Provider checkout detected. Parent approval required.</p>
                  <p>Final submit remains locked until you approve.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="container mx-auto max-w-6xl px-4 py-12">
          <div className="mb-8 max-w-2xl">
            <h2 className="text-3xl font-bold text-primary">Built for the registration-window scramble</h2>
            <p className="mt-3 text-muted-foreground">
              Version 1 is supervised on purpose: faster than manual signup, safer than pretending every provider page is ready for unattended automation.
            </p>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            {parentWins.map((item) => (
              <Card key={item.title}>
                <CardHeader>
                  <item.icon className="h-7 w-7 text-primary" />
                  <CardTitle>{item.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>{item.description}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-10 rounded-lg border bg-[hsl(var(--secondary))] p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
                  <Sparkles className="h-4 w-4" />
                  Set and Forget foundation
                </div>
                <p className="max-w-3xl text-muted-foreground">
                  Supervised runs capture the provider playbooks, pause reasons, price caps, and audit trail needed for future fully automated registration.
                </p>
              </div>
              <Link to="/autopilot">
                <Button variant="accent" className="w-full md:w-auto">
                  Create a run packet
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Index;
