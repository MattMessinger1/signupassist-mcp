import {
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Home,
  Menu,
  PauseCircle,
  Settings,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/BrandLogo";

const sidebarItems = [
  { label: "Home", icon: Home, active: true },
  { label: "Activity Finder", icon: Sparkles },
  { label: "My Children", icon: UsersRound },
  { label: "Billing & Plan", icon: CreditCard },
  { label: "Chrome Helper", icon: Zap },
  { label: "Settings", icon: Settings },
];

const pauseRows = [
  ["Payment", "Add card, review charges"],
  ["Waiver", "Read and agree"],
  ["Final submit", "You click to submit"],
  ["Unknown fields", "I'll check and wait"],
];

const fieldsFilled = [
  ["Child's Name", "Olivia Davis"],
  ["Date of Birth", "May 14, 2015 (Age 9)"],
  ["Parent Email", "jennifer.davis@email.com"],
  ["Phone", "(503) 555-0198"],
  ["Emergency Contact", "Mark Davis • (503) 555-0121"],
];

const cardClass = "rounded-lg border border-[#E2E8F0] bg-white shadow-[0_10px_30px_rgba(11,45,69,0.06)]";
const softPanelClass = "rounded-lg border border-[#D9E8EF] bg-[#F2F7FA]";

function SectionHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="mb-6 max-w-3xl">
      <p className="text-sm font-semibold uppercase tracking-[0.08em] text-[#1F5A7A]">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-normal text-[#102133]">{title}</h2>
      <p className="mt-3 text-base leading-7 text-[#334155]">{description}</p>
    </div>
  );
}

function ReadyBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#EAF7EF] px-2.5 py-1 text-xs font-semibold text-[#2F855A]">
      <Check className="h-3.5 w-3.5" />
      {children}
    </span>
  );
}

function ReviewBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#FFF3E2] px-2.5 py-1 text-xs font-semibold text-[#D9822B]">
      <PauseCircle className="h-3.5 w-3.5" />
      {children}
    </span>
  );
}

function DashboardMockup() {
  return (
    <section id="signupassist-dashboard" className="rounded-[28px] border border-[#E2E8F0] bg-white p-4 shadow-[0_24px_70px_rgba(11,45,69,0.08)]">
      <div className="grid min-h-[760px] overflow-hidden rounded-2xl border border-[#E2E8F0] bg-[#FAFBFC] lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="border-r border-[#E2E8F0] bg-white px-5 py-6">
          <div className="mb-8 flex items-center gap-3">
            <BrandLogo size="md" variant="light" />
            <span className="text-lg font-semibold text-[#0B2D45]">SignupAssist</span>
          </div>

          <nav className="space-y-1.5">
            {sidebarItems.map((item) => (
              <div
                key={item.label}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
                  item.active ? "bg-[#E8F2F7] text-[#0B2D45]" : "text-[#64748B]"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </div>
            ))}
          </nav>

          <div className="mt-10 rounded-lg border border-[#D9E8EF] bg-[#F2F7FA] p-4">
            <p className="text-sm font-semibold text-[#0B2D45]">Safe by design</p>
            <p className="mt-2 text-sm leading-6 text-[#64748B]">
              We pause for payment, waivers, and final submit.
            </p>
          </div>
        </aside>

        <div className="p-7">
          <header className="mb-7 flex items-center justify-between gap-6">
            <div>
              <h1 className="text-3xl font-semibold tracking-normal text-[#102133]">Good morning, Jordan!</h1>
              <p className="mt-2 text-[#64748B]">We&apos;ve got things covered. Here&apos;s what you need to know today.</p>
            </div>
            <div className="flex items-center gap-3">
              <button className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#E2E8F0] bg-white text-[#1F5A7A]">
                <Bell className="h-5 w-5" />
              </button>
              <div className="flex items-center gap-3 rounded-lg border border-[#E2E8F0] bg-white px-3 py-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#E8F2F7] text-sm font-semibold text-[#1F5A7A]">
                  J
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#102133]">Jordan Lee</p>
                  <p className="text-xs text-[#64748B]">Parent account</p>
                </div>
              </div>
            </div>
          </header>

          <div className="grid gap-5 lg:grid-cols-3">
            <div className={`${cardClass} lg:col-span-2`}>
              <div className="flex items-start justify-between gap-4 p-6">
                <div>
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-[#E8F2F7] text-[#1F5A7A]">
                    <CalendarDays className="h-5 w-5" />
                  </div>
                  <p className="text-sm font-semibold text-[#64748B]">Upcoming Registration</p>
                  <h3 className="mt-2 text-2xl font-semibold text-[#102133]">City Summer Camp</h3>
                  <p className="mt-1 text-[#334155]">Tomorrow • 9:00 AM</p>
                  <p className="mt-4 max-w-lg text-sm leading-6 text-[#64748B]">
                    Spots fill fast. Autopilot can watch and submit when it opens.
                  </p>
                </div>
                <ReviewBadge>Timing matters</ReviewBadge>
              </div>
            </div>

            <div className={cardClass}>
              <div className="p-6">
                <p className="text-sm font-semibold text-[#64748B]">Child Profiles</p>
                <div className="mt-2 flex items-center justify-between">
                  <h3 className="text-2xl font-semibold text-[#102133]">2 of 2 Ready</h3>
                  <ReadyBadge>Ready</ReadyBadge>
                </div>
                <div className="mt-5 space-y-3">
                  {["Olivia • Age 9", "Ethan • Age 7"].map((child) => (
                    <div key={child} className="flex items-center justify-between rounded-lg bg-[#F2F7FA] px-3 py-3">
                      <span className="text-sm font-medium text-[#334155]">{child}</span>
                      <Check className="h-4 w-4 text-[#2F855A]" />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className={cardClass}>
              <div className="p-6">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-[#E8F2F7] text-[#1F5A7A]">
                  <Zap className="h-5 w-5" />
                </div>
                <p className="text-sm font-semibold text-[#64748B]">Chrome Helper</p>
                <h3 className="mt-2 text-xl font-semibold text-[#102133]">Helper is on</h3>
                <p className="mt-2 text-sm leading-6 text-[#64748B]">
                  SignupAssist will alert you and act when it&apos;s time.
                </p>
                <ReadyBadge>Watching for you</ReadyBadge>
              </div>
            </div>

            <div className={cardClass}>
              <div className="p-6">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-[#F2F7FA] text-[#1F5A7A]">
                  <CircleDollarSign className="h-5 w-5" />
                </div>
                <p className="text-sm font-semibold text-[#64748B]">Billing & Plan</p>
                <h3 className="mt-2 text-xl font-semibold text-[#102133]">$9.99 / month</h3>
                <p className="mt-1 text-sm text-[#64748B]">Renews May 16</p>
                <button className="mt-5 rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm font-semibold text-[#1F5A7A]">
                  Cancel monthly renewal
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-[#D9E8EF] bg-[#E8F2F7] p-6 lg:col-span-1">
              <p className="text-sm font-semibold text-[#1F5A7A]">Safe. Secure. Parent-controlled.</p>
              <h3 className="mt-3 text-2xl font-semibold text-[#0B2D45]">Let SignupAssist do the watching.</h3>
              <p className="mt-3 text-sm leading-6 text-[#334155]">
                Start supervised autopilot and we&apos;ll handle the timing, so you don&apos;t have to.
              </p>
              <button className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#1F5A7A] px-5 py-3 text-sm font-semibold text-white shadow-sm">
                Start supervised autopilot
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function HelperPopupMockup() {
  return (
    <section id="signupassist-helper-popup" className="rounded-[28px] border border-[#E2E8F0] bg-white p-4 shadow-[0_24px_70px_rgba(11,45,69,0.08)]">
      <div className="relative min-h-[680px] overflow-hidden rounded-2xl border border-[#E2E8F0] bg-[#F2F7FA] p-8">
        <div className="absolute inset-8 rounded-2xl border border-[#E2E8F0] bg-white/75 p-8 opacity-70 blur-[1px]">
          <div className="mb-5 h-8 w-56 rounded bg-[#E8F2F7]" />
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="rounded-lg border border-[#E2E8F0] bg-white p-4">
                <div className="mb-3 h-3 w-28 rounded bg-[#E2E8F0]" />
                <div className="h-10 rounded border border-[#E2E8F0] bg-[#FAFBFC]" />
              </div>
            ))}
          </div>
        </div>

        <div className="relative ml-auto w-[380px] rounded-2xl border border-[#D9E8EF] bg-white p-4 shadow-[0_24px_60px_rgba(11,45,69,0.18)]">
          <header className="mb-4 flex items-center justify-between border-b border-[#E2E8F0] pb-4">
            <div className="flex items-center gap-3">
              <BrandLogo size="md" variant="light" />
              <div>
                <h3 className="text-base font-semibold text-[#102133]">SignupAssist Helper</h3>
                <p className="text-xs text-[#64748B]">Supervised mode</p>
              </div>
            </div>
            <Menu className="h-5 w-5 text-[#64748B]" />
          </header>

          <div className="grid gap-3">
            {[
              ["Provider detected", "ActiveNetwork"],
              ["Child selected", "Emma Johnson • Age 9"],
              ["Price cap", "$250.00"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.06em] text-[#64748B]">{label}</p>
                <p className="mt-1 text-sm font-semibold text-[#102133]">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-lg border border-[#D9E8EF] bg-[#E8F2F7] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[#0B2D45]">Filling safe fields</p>
                <p className="mt-1 text-xs text-[#334155]">Working now. This usually takes a few seconds.</p>
              </div>
              <span className="text-sm font-semibold text-[#1F5A7A]">68%</span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white">
              <div className="h-full w-[68%] rounded-full bg-[#1F5A7A]" />
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {pauseRows.map(([title, description]) => (
              <div key={title} className="flex items-center justify-between rounded-lg border border-[#F3D8B6] bg-[#FFF3E2] px-3 py-3">
                <div>
                  <p className="text-sm font-semibold text-[#102133]">{title}</p>
                  <p className="text-xs text-[#64748B]">{description}</p>
                </div>
                <ReviewBadge>Paused for you</ReviewBadge>
              </div>
            ))}
          </div>

          <footer className="mt-4 rounded-lg border border-[#E2E8F0] bg-[#FAFBFC] p-3">
            <div className="mb-3 flex items-center gap-2 text-xs font-medium text-[#334155]">
              <ShieldCheck className="h-4 w-4 text-[#1F5A7A]" />
              Only fills low-risk info. You&apos;re always in control.
            </div>
            <button className="w-full rounded-lg border border-[#E2E8F0] bg-white px-4 py-2.5 text-sm font-semibold text-[#0B2D45]">
              Pause Helper
            </button>
          </footer>
        </div>
      </div>
    </section>
  );
}

function SupervisedOverlayMockup() {
  return (
    <section id="signupassist-supervised-overlay" className="rounded-[28px] border border-[#E2E8F0] bg-white p-4 shadow-[0_24px_70px_rgba(11,45,69,0.08)]">
      <div className="grid min-h-[780px] overflow-hidden rounded-2xl border border-[#E2E8F0] bg-[#FAFBFC] lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="p-8">
          <header className="mb-6 flex items-center justify-between border-b border-[#E2E8F0] pb-5">
            <div>
              <p className="text-sm font-semibold text-[#1F5A7A]">Westview Parks & Rec</p>
              <h3 className="mt-1 text-2xl font-semibold text-[#102133]">Summer Soccer Camp</h3>
            </div>
            <span className="rounded-full bg-[#E8F2F7] px-3 py-1 text-sm font-semibold text-[#1F5A7A]">
              $185.00
            </span>
          </header>

          <div className="mb-8 grid grid-cols-4 gap-3">
            {["Choose Program", "Participant Details", "Waivers", "Review & Pay"].map((step, index) => (
              <div key={step} className="rounded-lg border border-[#E2E8F0] bg-white p-3">
                <div
                  className={`mb-2 flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                    index < 2
                      ? "bg-[#EAF7EF] text-[#2F855A]"
                      : index === 2
                        ? "bg-[#FFF3E2] text-[#D9822B]"
                        : "bg-[#F2F7FA] text-[#64748B]"
                  }`}
                >
                  {index + 1}
                </div>
                <p className="text-xs font-medium text-[#334155]">{step}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className={softPanelClass}>
              <div className="p-5">
                <p className="text-sm font-semibold text-[#64748B]">Session</p>
                <h4 className="mt-2 text-xl font-semibold text-[#102133]">July 8–12 • 9:00 AM – 12:00 PM</h4>
                <p className="mt-2 text-sm text-[#64748B]">Ages 8–10 • Meadow Field</p>
              </div>
            </div>
            <div className={softPanelClass}>
              <div className="p-5">
                <p className="text-sm font-semibold text-[#64748B]">Participant</p>
                <h4 className="mt-2 text-xl font-semibold text-[#102133]">Olivia Davis</h4>
                <p className="mt-2 text-sm text-[#64748B]">Age 9 • Parent: Jennifer Davis</p>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-lg border border-[#E2E8F0] bg-white p-5">
            <p className="mb-4 text-sm font-semibold text-[#102133]">Participant Details</p>
            <div className="grid gap-4 md:grid-cols-2">
              {["Olivia Davis", "May 14, 2015", "Jennifer Davis", "jennifer.davis@email.com"].map((value) => (
                <div key={value}>
                  <div className="mb-2 h-3 w-28 rounded bg-[#E8F2F7]" />
                  <div className="rounded-lg border border-[#D6E6DE] bg-[#F8FCFA] px-3 py-2.5 text-sm text-[#334155]">
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="border-l border-[#E2E8F0] bg-white p-6">
          <div className="mb-5 flex items-center gap-3">
            <BrandLogo size="lg" variant="light" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#1F5A7A]">Supervised Autopilot</p>
              <h3 className="mt-1 text-xl font-semibold text-[#102133]">SignupAssist is helping you register Olivia!</h3>
            </div>
          </div>

          <p className="mb-5 text-sm leading-6 text-[#64748B]">
            I&apos;ve filled in the details you&apos;ve shared and got everything ready. Please review before we continue.
          </p>

          <div className="rounded-lg border border-[#D9E8EF] bg-[#F2F7FA] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[#0B2D45]">Step 3 of 4</p>
                <p className="text-xs text-[#64748B]">Reviewing details</p>
              </div>
              <Clock3 className="h-5 w-5 text-[#1F5A7A]" />
            </div>
            <div className="mt-4 h-2 rounded-full bg-white">
              <div className="h-full w-3/4 rounded-full bg-[#1F5A7A]" />
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-[#F3D8B6] bg-[#FFF3E2] p-4">
            <ReviewBadge>Paused for your review</ReviewBadge>
            <p className="mt-3 text-sm leading-6 text-[#334155]">
              Waiting for your approval before completing waivers and payment.
            </p>
          </div>

          <div className="mt-4 rounded-lg border border-[#E2E8F0] bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-[#102133]">Fields filled (7 of 7)</p>
              <ReadyBadge>Complete</ReadyBadge>
            </div>
            <div className="space-y-2">
              {fieldsFilled.map(([label, value]) => (
                <div key={label} className="flex gap-3 rounded-lg bg-[#FAFBFC] px-3 py-2.5">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#2F855A]" />
                  <div>
                    <p className="text-xs font-semibold text-[#64748B]">{label}</p>
                    <p className="text-sm text-[#334155]">{value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-[#D9E8EF] bg-[#F2F7FA] p-4">
            <p className="mb-3 text-sm font-semibold text-[#102133]">Final approval summary</p>
            {[
              ["Provider", "Westview Parks & Rec"],
              ["Child", "Olivia Davis • Age 9"],
              ["Session", "Summer Soccer Camp"],
              ["Price", "$185.00"],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 border-b border-[#D9E8EF] py-2 last:border-0">
                <span className="text-sm text-[#64748B]">{label}</span>
                <span className="text-right text-sm font-semibold text-[#102133]">{value}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-2">
            <button className="rounded-lg bg-[#1F5A7A] px-4 py-3 text-sm font-semibold text-white shadow-sm">
              Approve and continue
            </button>
            <button className="rounded-lg border border-[#E2E8F0] bg-white px-4 py-3 text-sm font-semibold text-[#0B2D45]">
              Edit details
            </button>
            <button className="rounded-lg border border-[#F1C8B5] bg-white px-4 py-3 text-sm font-semibold text-[#C2410C]">
              Cancel autopilot
            </button>
          </div>

          <p className="mt-4 text-center text-xs text-[#64748B]">
            You&apos;re in control. We&apos;ll only continue when you approve.
          </p>
        </aside>
      </div>
    </section>
  );
}

export default function SignupAssistMockups() {
  return (
    <main className="min-h-screen bg-[#FAFBFC] px-5 py-8 text-[#102133]">
      <div className="mx-auto max-w-7xl">
        <header className="mb-10 flex flex-col gap-5 rounded-[28px] border border-[#E2E8F0] bg-white p-6 shadow-[0_18px_50px_rgba(11,45,69,0.06)] md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <BrandLogo size="xl" variant="light" />
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.08em] text-[#1F5A7A]">SignupAssist UI / UX Direction</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-normal text-[#102133]">
                Calm, fast, parent-controlled signup help
              </h1>
            </div>
          </div>
          <div className="rounded-lg bg-[#FFF3E2] px-4 py-3 text-sm font-medium text-[#8A4B12]">
            Logo rendered slightly wider with the same shield and heart identity.
          </div>
        </header>

        <div className="mb-8 flex flex-wrap gap-3">
          {[
            ["Dashboard", "#signupassist-dashboard"],
            ["Helper popup", "#signupassist-helper-popup"],
            ["Supervised overlay", "#signupassist-supervised-overlay"],
          ].map(([label, href]) => (
            <a key={label} href={href} className="rounded-full border border-[#D9E8EF] bg-white px-4 py-2 text-sm font-semibold text-[#1F5A7A]">
              {label}
            </a>
          ))}
        </div>

        <div className="space-y-14">
          <div>
            <SectionHeader
              eyebrow="Mockup 01"
              title="SignupAssist parent dashboard"
              description="A calm command center for busy parents: what is coming up, what is ready, what is active, and how billing works."
            />
            <DashboardMockup />
          </div>

          <div>
            <SectionHeader
              eyebrow="Mockup 02"
              title="Chrome extension popup"
              description="Compact helper UI that feels fast and controlled on a live provider registration page."
            />
            <HelperPopupMockup />
          </div>

          <div>
            <SectionHeader
              eyebrow="Mockup 03"
              title="On-page supervised autopilot overlay"
              description="A high-trust approval surface that shows what was filled, why SignupAssist paused, and what the parent approves next."
            />
            <SupervisedOverlayMockup />
          </div>
        </div>
      </div>
    </main>
  );
}
