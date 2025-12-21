/**
 * FeeBreakdown - Displays program fee, service fee, and total
 * Uses shared core library for calculations and formatting
 */

import React from 'react';
import { 
  calculateServiceFee as calculateServiceFeeCore, 
  formatMoney, 
  COPY 
} from '../../lib/core';

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
  programFeeLabel = COPY.fees.programFeeLabel,
  serviceFeeLabel = COPY.fees.serviceFeeLabel,
  serviceFeeNote,
  className = '',
}: FeeBreakdownProps) {
  const totalCents = programFeeCents + serviceFeeCents;

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
        <span className="text-sm font-semibold text-gray-900">{COPY.fees.totalLabel}</span>
        <span className="text-lg font-bold text-gray-900">{formatMoney(totalCents)}</span>
      </div>
    </div>
  );
}

// Re-export for backwards compatibility
export { calculateServiceFeeCore as calculateServiceFee };
