import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ConfirmationCardProps {
  title?: string;
  message: string;
  onConfirm: () => void;
  onCancel?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}

export function ConfirmationCard({
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel"
}: ConfirmationCardProps) {
  return (
    <Card className="mt-3 border-primary/20">
      {title && (
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent className="pb-3">
        <CardDescription className="text-foreground">{message}</CardDescription>
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button onClick={onConfirm} size="sm" className="flex-1">
          {confirmLabel}
        </Button>
        {onCancel && (
          <Button onClick={onCancel} variant="outline" size="sm" className="flex-1">
            {cancelLabel}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
