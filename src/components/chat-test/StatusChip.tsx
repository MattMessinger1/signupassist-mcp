import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatusChipProps {
  label: string;
  status: "done" | "pending" | "error";
  className?: string;
}

export function StatusChip({ label, status, className }: StatusChipProps) {
  const icons = {
    done: <CheckCircle2 className="h-3 w-3" />,
    pending: <Clock className="h-3 w-3" />,
    error: <AlertCircle className="h-3 w-3" />
  };

  const variants = {
    done: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
    pending: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20",
    error: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20"
  };

  return (
    <Badge 
      variant="outline" 
      className={cn("inline-flex items-center gap-1 px-2 py-0.5", variants[status], className)}
    >
      {icons[status]}
      <span className="text-xs">{label}</span>
    </Badge>
  );
}
