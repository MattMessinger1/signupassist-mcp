import React, { useState, useMemo } from "react";
import { ChevronDown, ChevronUp, ShieldCheck, Clock, AlertTriangle, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { mapScopeToFriendly } from "@/copy/signupassistCopy";

interface DecodedMandateViewerProps {
  jwsCompact: string;
  compact?: boolean;
}

interface DecodedPayload {
  iss?: string;
  sub?: string;
  aud?: string;
  iat?: number;
  exp?: number;
  nbf?: number;
  provider?: string;
  scopes?: string[];
  org_ref?: string;
  max_amount_cents?: number;
  child_id?: string;
  program_ref?: string;
  [key: string]: unknown;
}

function decodeJWS(jws: string): { header: Record<string, unknown>; payload: DecodedPayload } | null {
  try {
    const parts = jws.split('.');
    if (parts.length !== 3) return null;
    
    const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    
    return { header, payload };
  } catch {
    return null;
  }
}

function formatTimestamp(ts?: number): string {
  if (!ts) return 'N/A';
  return new Date(ts * 1000).toLocaleString();
}

function isExpired(exp?: number): boolean {
  if (!exp) return false;
  return Date.now() > exp * 1000;
}

export function DecodedMandateViewer({ jwsCompact, compact = false }: DecodedMandateViewerProps) {
  const [expanded, setExpanded] = useState(false);
  
  const decoded = useMemo(() => decodeJWS(jwsCompact), [jwsCompact]);
  
  if (!decoded) {
    return (
      <div className="text-xs text-destructive flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" />
        Invalid token format
      </div>
    );
  }
  
  const { header, payload } = decoded;
  const expired = isExpired(payload.exp);
  const scopes = payload.scopes || [];
  
  if (compact && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Lock className="h-3 w-3" />
        <span>View Mandate Token</span>
        <ChevronDown className="h-3 w-3" />
      </button>
    );
  }
  
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
      {/* Header with collapse button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className={`h-4 w-4 ${expired ? 'text-destructive' : 'text-emerald-500'}`} />
          <span className="text-sm font-medium">
            {expired ? 'Expired Mandate' : 'Valid Mandate'}
          </span>
          {header.alg && (
            <Badge variant="outline" className="text-xs">
              {String(header.alg)}
            </Badge>
          )}
        </div>
        {compact && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <span>Hide</span>
            <ChevronUp className="h-3 w-3" />
          </button>
        )}
      </div>
      
      {/* Provider & Program */}
      {(payload.provider || payload.program_ref) && (
        <div className="flex flex-wrap gap-2">
          {payload.provider && (
            <Badge variant="secondary" className="text-xs">
              Provider: {payload.provider}
            </Badge>
          )}
          {payload.program_ref && (
            <Badge variant="secondary" className="text-xs">
              Program: {payload.program_ref}
            </Badge>
          )}
        </div>
      )}
      
      {/* Scopes */}
      {scopes.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Authorized Scopes:</div>
          <div className="flex flex-wrap gap-1.5">
            {scopes.map((scope) => {
              const { icon, label } = mapScopeToFriendly(scope);
              return (
                <Badge key={scope} variant="outline" className="text-xs font-normal">
                  {icon} {label}
                </Badge>
              );
            })}
          </div>
        </div>
      )}
      
      {/* Time validity */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">Valid from:</span>
          <span className="text-foreground">{formatTimestamp(payload.nbf || payload.iat)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className={`h-3 w-3 ${expired ? 'text-destructive' : 'text-muted-foreground'}`} />
          <span className={expired ? 'text-destructive' : 'text-muted-foreground'}>
            {expired ? 'Expired:' : 'Valid until:'}
          </span>
          <span className={expired ? 'text-destructive' : 'text-foreground'}>
            {formatTimestamp(payload.exp)}
          </span>
        </div>
      </div>
      
      {/* Max amount if present */}
      {payload.max_amount_cents && (
        <div className="text-xs">
          <span className="text-muted-foreground">Max Amount: </span>
          <span className="font-medium">${(payload.max_amount_cents / 100).toFixed(2)}</span>
        </div>
      )}
      
      {/* Signature indicator */}
      <div className="text-xs text-muted-foreground/70 flex items-center gap-1 pt-1 border-t border-border/50">
        <Lock className="h-3 w-3" />
        Cryptographically signed (signature present)
      </div>
    </div>
  );
}