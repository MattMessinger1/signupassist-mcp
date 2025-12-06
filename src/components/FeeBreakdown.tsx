import React from "react";

interface FeeBreakdownProps {
  programFee: number;
  serviceFee: number;
  total: number;
  programFeeLabel: string;
  serviceFeeLabel: string;
  serviceFeeNote?: string;
}

export function FeeBreakdown({
  programFee,
  serviceFee,
  total,
  programFeeLabel,
  serviceFeeLabel,
  serviceFeeNote,
}: FeeBreakdownProps) {
  const money = (n: number) =>
    n.toLocaleString(undefined, { style: "currency", currency: "USD" });

  return (
    <div className="mt-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{programFeeLabel}</span>
        <span className="font-semibold text-foreground">{money(programFee)}</span>
      </div>
      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{serviceFeeLabel}</span>
        <span className="font-semibold text-foreground">{money(serviceFee)}</span>
      </div>
      {serviceFeeNote && (
        <div className="mt-1 text-xs text-muted-foreground">{serviceFeeNote}</div>
      )}
      <div className="mt-3 border-t border-border pt-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">Total</span>
        <span className="text-sm font-semibold text-foreground">{money(total)}</span>
      </div>
    </div>
  );
}
