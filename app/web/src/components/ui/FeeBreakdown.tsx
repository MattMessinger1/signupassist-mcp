/**
 * FeeBreakdown - Displays program fee, service fee, and total
 * Ported from src/components/FeeBreakdown.tsx for ChatGPT Apps SDK
 */

import React from 'react';

interface FeeBreakdownProps {
  programFeeCents: number;
  serviceFeeCents: number;
  programFeeLabel?: string;
  serviceFeeLabel?: string;
  serviceFeeNote?: string;
  className?: string;
}

export function FeeBreakdown({
  programFeeCents,
  serviceFeeCents,
  programFeeLabel = 'Program Fee',
  serviceFeeLabel = 'Service Fee',
  serviceFeeNote,
  className = '',
}: FeeBreakdownProps) {
  const totalCents = programFeeCents + serviceFeeCents;

  const formatMoney = (cents: number) =>
    (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });

  return (
    <div className={`rounded-xl border border-gray-200 bg-gray-50 p-4 ${className}`}>
      {/* Program Fee */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-600">{programFeeLabel}</span>
        <span className="font-semibold text-gray-900">{formatMoney(programFeeCents)}</span>
      </div>
      
      {/* Service Fee */}
      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="text-gray-600">{serviceFeeLabel}</span>
        <span className="font-semibold text-gray-900">{formatMoney(serviceFeeCents)}</span>
      </div>
      
      {/* Service Fee Note */}
      {serviceFeeNote && (
        <p className="mt-1 text-xs text-gray-500">{serviceFeeNote}</p>
      )}
      
      {/* Total */}
      <div className="mt-3 border-t border-gray-200 pt-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-900">Total</span>
        <span className="text-lg font-bold text-gray-900">{formatMoney(totalCents)}</span>
      </div>
    </div>
  );
}

// Pre-calculated service fee helper
export function calculateServiceFee(programFeeCents: number, feePercentage = 5): number {
  // Minimum $1.99, cap at $9.99
  const calculated = Math.round(programFeeCents * (feePercentage / 100));
  return Math.max(199, Math.min(calculated, 999));
}
