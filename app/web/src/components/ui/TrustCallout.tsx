/**
 * TrustCallout - Security and trust messaging component
 * Adapted from src/components/TrustCallout.tsx for widget use
 */

import React from "react";

interface TrustCalloutProps {
  title: string;
  bullets: string[];
  footer?: string;
  refundHelp?: string;
}

export function TrustCallout({ title, bullets, footer, refundHelp }: TrustCalloutProps) {
  return (
    <div className="mt-3 rounded-2xl border border-gray-200 bg-gray-50 p-4">
      <div className="text-sm font-semibold text-gray-900">{title}</div>
      <ul className="mt-2 space-y-1 text-sm text-gray-600">
        {bullets.map((b, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[2px] inline-block h-2 w-2 flex-none rounded-full bg-gray-400" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      {footer && (
        <div className="mt-3 text-xs text-gray-500">{footer}</div>
      )}
      {refundHelp && (
        <div className="mt-2 text-xs text-gray-500">{refundHelp}</div>
      )}
    </div>
  );
}
