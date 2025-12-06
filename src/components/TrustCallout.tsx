import React from "react";

interface TrustCalloutProps {
  title: string;
  bullets: string[];
  footer?: string;
}

export function TrustCallout({ title, bullets, footer }: TrustCalloutProps) {
  return (
    <div className="mt-3 rounded-2xl border border-border bg-muted p-4">
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
        {bullets.map((b) => (
          <li key={b} className="flex gap-2">
            <span className="mt-[2px] inline-block h-2 w-2 flex-none rounded-full bg-muted-foreground/50" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      {footer && (
        <div className="mt-3 text-xs text-muted-foreground">{footer}</div>
      )}
    </div>
  );
}
