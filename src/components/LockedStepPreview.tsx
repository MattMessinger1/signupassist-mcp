import { Lock } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface LockedStepPreviewProps {
  stepNumber: number;
  title: string;
  description: string;
  prerequisite: string;
}

export function LockedStepPreview({ stepNumber, title, description, prerequisite }: LockedStepPreviewProps) {
  return (
    <Card className="opacity-60 border-dashed">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">Step {stepNumber}</Badge>
          <CardTitle className="flex items-center gap-2 text-muted-foreground">
            <Lock className="h-4 w-4" />
            {title}
          </CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="p-4 bg-muted/30 border border-muted rounded-lg">
          <p className="text-sm text-muted-foreground text-center">
            🔒 Available after {prerequisite}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
