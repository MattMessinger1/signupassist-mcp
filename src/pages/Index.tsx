import { Link } from "react-router-dom";
import { BellRing, CheckCircle2, LockKeyhole, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Header } from "@/components/Header";

const providerPath = "/autopilot";

const steps = [
  {
    number: "1",
    title: "Find your activity",
    description:
      "Browse a list of verified providers and choose the camp, class, or sport you want.",
  },
  {
    number: "2",
    title: "Enter info once",
    description:
      "Add your child details, emergency contacts, and payment information once. Everything is encrypted and reusable.",
  },
  {
    number: "3",
    title: "Get a reminder",
    description:
      "We text and email you 5-10 minutes before signup opens, and you stay in control of the final signup.",
  },
];

const trustItems = [
  {
    icon: CheckCircle2,
    title: "Verified providers",
    description:
      "We work with supported registration systems so you know what to expect.",
  },
  {
    icon: LockKeyhole,
    title: "Encrypted information",
    description:
      "Your child and payment details are stored securely and can be reused.",
  },
  {
    icon: ShieldCheck,
    title: "Parent approval",
    description:
      "Sensitive fields and final signup always stay under your control.",
  },
];

const trustNotes = [
  "Verified providers",
  "Encrypted family and payment info",
  "You always approve final signup",
];

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main>
        <section className="border-b bg-[hsl(var(--secondary))]">
          <div className="container mx-auto max-w-6xl px-4 py-20 sm:py-24">
            <div className="mx-auto max-w-3xl space-y-6 text-center">
              <h1 className="text-4xl font-bold tracking-normal text-primary sm:text-5xl lg:text-6xl">
                Fast camp and class signup, without the chaos.
              </h1>

              <p className="text-lg text-muted-foreground sm:text-xl">
                Choose a verified provider, save your family info once, and get a reminder right before registration opens.
              </p>

              <div className="flex flex-col justify-center gap-3 sm:flex-row">
                <Link to={providerPath}>
                  <Button size="lg" className="w-full sm:w-auto">
                    See verified providers
                  </Button>
                </Link>
                <a href="#how-it-works">
                  <Button size="lg" variant="outline" className="w-full sm:w-auto">
                    How it works
                  </Button>
                </a>
              </div>

              <div className="flex flex-col items-center gap-2 pt-2 text-sm text-muted-foreground sm:flex-row sm:justify-center sm:gap-6">
                {trustNotes.map((note) => (
                  <span key={note} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    {note}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="container mx-auto max-w-6xl px-4 py-16">
          <div className="mx-auto max-w-2xl space-y-3 text-center">
            <h2 className="text-3xl font-bold text-primary sm:text-4xl">
              How it works
            </h2>
            <p className="text-muted-foreground">
              A simple 3-step flow for busy parents.
            </p>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {steps.map((step) => (
              <Card key={step.number} className="h-full">
                <CardHeader className="space-y-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
                    {step.number}
                  </div>
                  <CardTitle>{step.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">{step.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="border-y bg-[hsl(var(--secondary))]">
          <div className="container mx-auto max-w-6xl px-4 py-16">
            <div className="grid gap-6 md:grid-cols-3">
              {trustItems.map((item) => (
                <Card key={item.title}>
                  <CardHeader>
                    <item.icon className="h-6 w-6 text-primary" />
                    <CardTitle>{item.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground">{item.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="container mx-auto max-w-4xl px-4 py-20">
          <div className="rounded-lg border bg-background p-8 text-center shadow-sm">
            <BellRing className="mx-auto mb-4 h-8 w-8 text-primary" />
            <h2 className="text-3xl font-bold text-primary">
              Ready to make signup easier?
            </h2>
            <p className="mt-3 text-muted-foreground">
              Find a verified provider and save your information before registration day.
            </p>

            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <Link to={providerPath}>
                <Button size="lg" className="w-full sm:w-auto">
                  See verified providers
                </Button>
              </Link>
              <a href="#how-it-works">
                <Button size="lg" variant="outline" className="w-full sm:w-auto">
                  How it works
                </Button>
              </a>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Index;
