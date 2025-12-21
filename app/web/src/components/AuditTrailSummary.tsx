/**
 * AuditTrailSummary Component
 * 
 * Displays mandate execution history with timestamps and tool actions.
 * Uses shared core library for formatting and copy.
 * Designed for the ChatGPT Apps SDK widget.
 */

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/primitives';
import { formatDateTime, formatRelativeTime } from '../lib/core/formatting';
import { mapToolNameToUserTitle, mapScopeToFriendly, COPY } from '../lib/core/copy';

// ============ Types ============

export interface AuditEvent {
  id: string;
  at: string; // ISO timestamp
  status: 'success' | 'pending' | 'failed';
  tool?: string;
  userTitle?: string;
  userSubtitle?: string;
  argsHash?: string;
  resultHash?: string;
  mandateJws?: string;
  technical?: Record<string, string>;
}

export interface AuditTrailSummaryProps {
  events: AuditEvent[];
  mandateScopes?: string[];
  showTechnicalDetails?: boolean;
  compact?: boolean;
}

// ============ Helper Functions ============

function getStatusColor(status: AuditEvent['status']): string {
  switch (status) {
    case 'success':
      return 'bg-emerald-500';
    case 'failed':
      return 'bg-destructive';
    case 'pending':
    default:
      return 'bg-amber-500';
  }
}

function getStatusLabel(status: AuditEvent['status']): string {
  switch (status) {
    case 'success':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'pending':
    default:
      return 'In Progress';
  }
}

function truncateHash(hash: string, chars = 6): string {
  if (hash.length <= chars * 2) return hash;
  return `${hash.slice(0, chars)}…${hash.slice(-chars)}`;
}

// ============ Sub-Components ============

interface StatusDotProps {
  status: AuditEvent['status'];
  showLine?: boolean;
}

function StatusDot({ status, showLine }: StatusDotProps) {
  return (
    <div className="flex flex-col items-center">
      <div className={`h-2.5 w-2.5 rounded-full ${getStatusColor(status)}`} />
      {showLine && <div className="mt-1 h-full w-px bg-border" />}
    </div>
  );
}

interface HashBadgeProps {
  label: string;
  hash: string;
  onCopy?: () => void;
}

function HashBadge({ label, hash, onCopy }: HashBadgeProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onCopy?.();
    } catch {
      // Clipboard API not available
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      title={`Click to copy: ${hash}`}
    >
      <span className="text-muted-foreground/70">{label}:</span>
      <code className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">
        {truncateHash(hash)}
      </code>
      {copied && (
        <svg className="h-3 w-3 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  );
}

interface ScopeBadgeProps {
  scope: string;
}

function ScopeBadge({ scope }: ScopeBadgeProps) {
  const { icon, label } = mapScopeToFriendly(scope);
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary">
      <span>{icon}</span>
      <span>{label}</span>
    </span>
  );
}

interface EventRowProps {
  event: AuditEvent;
  isLast: boolean;
  showTechnical: boolean;
}

function EventRow({ event, isLast, showTechnical }: EventRowProps) {
  const title = event.userTitle || (event.tool ? mapToolNameToUserTitle(event.tool) : 'Action');
  
  return (
    <div className="flex gap-3">
      <div className="mt-1">
        <StatusDot status={event.status} showLine={!isLast} />
      </div>
      
      <div className="min-w-0 flex-1 space-y-1 pb-4">
        {/* Title and Time */}
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-foreground">{title}</span>
          <span className="text-xs text-muted-foreground" title={formatDateTime(event.at)}>
            {formatRelativeTime(event.at)}
          </span>
        </div>
        
        {/* Subtitle */}
        {event.userSubtitle && (
          <p className="text-xs text-muted-foreground">{event.userSubtitle}</p>
        )}
        
        {/* Integrity Hashes */}
        {(event.argsHash || event.resultHash) && (
          <div className="flex flex-wrap gap-3 pt-1">
            {event.argsHash && <HashBadge label="🔏 Input" hash={event.argsHash} />}
            {event.resultHash && <HashBadge label="🔏 Output" hash={event.resultHash} />}
          </div>
        )}
        
        {/* Technical Details */}
        {showTechnical && event.technical && Object.keys(event.technical).length > 0 && (
          <div className="mt-2 rounded-lg bg-muted p-2 text-xs space-y-1">
            {Object.entries(event.technical).map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <span className="text-muted-foreground/70 min-w-[80px]">{key}</span>
                <span className="text-foreground break-all">{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============ Main Component ============

export function AuditTrailSummary({ 
  events, 
  mandateScopes,
  showTechnicalDetails = false,
  compact = false 
}: AuditTrailSummaryProps) {
  const [showTech, setShowTech] = useState(showTechnicalDetails);

  // Sort events chronologically
  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
    [events]
  );

  // Calculate summary stats
  const stats = useMemo(() => {
    const total = events.length;
    const completed = events.filter(e => e.status === 'success').length;
    const failed = events.filter(e => e.status === 'failed').length;
    const pending = events.filter(e => e.status === 'pending').length;
    return { total, completed, failed, pending };
  }, [events]);

  if (events.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-muted-foreground">
          No audit events to display.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{COPY.audit.title}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{COPY.audit.subtitle}</p>
          </div>
          
          {!compact && (
            <button
              type="button"
              onClick={() => setShowTech(v => !v)}
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {showTech ? COPY.audit.ctaHideTech : COPY.audit.ctaShowTech}
            </button>
          )}
        </div>

        {/* Scopes Display */}
        {mandateScopes && mandateScopes.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {mandateScopes.map((scope, idx) => (
              <ScopeBadge key={idx} scope={scope} />
            ))}
          </div>
        )}

        {/* Stats Summary */}
        {!compact && stats.total > 1 && (
          <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
            <span>{stats.total} actions</span>
            {stats.completed > 0 && (
              <span className="text-emerald-600">{stats.completed} completed</span>
            )}
            {stats.pending > 0 && (
              <span className="text-amber-600">{stats.pending} pending</span>
            )}
            {stats.failed > 0 && (
              <span className="text-destructive">{stats.failed} failed</span>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="pt-0">
        <div className="space-y-0">
          {sortedEvents.map((event, idx) => (
            <EventRow
              key={event.id}
              event={event}
              isLast={idx === sortedEvents.length - 1}
              showTechnical={showTech}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default AuditTrailSummary;
