import React, { useMemo, useState } from "react";
import { COPY } from "@/copy/signupassistCopy";
import { DecodedMandateViewer } from "@/components/DecodedMandateViewer";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Copy, Check } from "lucide-react";

export type AuditEvent = {
  id: string;
  at: string; // ISO string
  status: "success" | "pending" | "failed";
  userTitle: string; // friendly label
  userSubtitle?: string;
  technical?: Record<string, string>;
  // New fields for enhanced audit trail
  argsHash?: string;
  resultHash?: string;
  mandateJws?: string;
};

function statusDot(status: AuditEvent["status"]) {
  if (status === "success") return "bg-emerald-500";
  if (status === "failed") return "bg-destructive";
  return "bg-amber-500";
}

function truncateHash(hash: string, chars = 8): string {
  if (hash.length <= chars * 2) return hash;
  return `${hash.slice(0, chars)}...${hash.slice(-chars)}`;
}

interface HashDisplayProps {
  label: string;
  hash: string;
}

function HashDisplay({ label, hash }: HashDisplayProps) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    await navigator.clipboard.writeText(hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group"
          >
            <span className="text-muted-foreground/70">{label}:</span>
            <code className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">
              {truncateHash(hash)}
            </code>
            {copied ? (
              <Check className="h-3 w-3 text-emerald-500" />
            ) : (
              <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-xs font-mono break-all">{hash}</p>
          <p className="text-xs text-muted-foreground mt-1">Click to copy full hash</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface AuditTrailTimelineProps {
  events: AuditEvent[];
}

export function AuditTrailTimeline({ events }: AuditTrailTimelineProps) {
  const [showTech, setShowTech] = useState(false);

  const sorted = useMemo(
    () => [...events].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
    [events]
  );

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">{COPY.audit.title}</div>
          <div className="mt-1 text-xs text-muted-foreground">{COPY.audit.subtitle}</div>
        </div>
        <button
          type="button"
          onClick={() => setShowTech((v) => !v)}
          className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {showTech ? COPY.audit.ctaHideTech : COPY.audit.ctaShowTech}
        </button>
      </div>

      <div className="mt-4 space-y-4">
        {sorted.map((e, idx) => (
          <div key={e.id} className="flex gap-3">
            <div className="mt-1 flex flex-col items-center">
              <div className={`h-2.5 w-2.5 rounded-full ${statusDot(e.status)}`} />
              {idx < sorted.length - 1 && (
                <div className="mt-1 h-full w-px bg-border" />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-sm font-medium text-foreground">{e.userTitle}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(e.at).toLocaleString()}
                </div>
              </div>
              {e.userSubtitle && (
                <div className="text-xs text-muted-foreground">{e.userSubtitle}</div>
              )}
              
              {/* Integrity hashes - always visible when present */}
              {(e.argsHash || e.resultHash) && (
                <div className="flex flex-wrap gap-3">
                  {e.argsHash && <HashDisplay label="🔏 Input" hash={e.argsHash} />}
                  {e.resultHash && <HashDisplay label="🔏 Output" hash={e.resultHash} />}
                </div>
              )}
              
              {/* Mandate viewer - compact by default */}
              {e.mandateJws && (
                <div className="mt-2">
                  <DecodedMandateViewer jwsCompact={e.mandateJws} compact />
                </div>
              )}
              
              {showTech && e.technical && Object.keys(e.technical).length > 0 && (
                <div className="mt-2 rounded-xl bg-muted p-3 text-xs text-muted-foreground">
                  {Object.entries(e.technical).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <span className="w-32 flex-none text-muted-foreground/70">{k}</span>
                      <span className="break-all text-foreground">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
