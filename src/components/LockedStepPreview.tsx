import { Lock, ArrowDown } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface LockedStepPreviewProps {
  stepNumber: number;
  title: string;
  description: string;
  prerequisite: string;
  icon?: React.ReactNode;
  onScrollToPrerequisite?: () => void;
}

export function LockedStepPreview({ 
  stepNumber, 
  title, 
  description, 
  prerequisite,
  icon,
  onScrollToPrerequisite
}: LockedStepPreviewProps) {
  return (
    <Card className="opacity-60 border-dashed bg-muted/20">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs bg-muted">Step {stepNumber}</Badge>
          <CardTitle className="flex items-center gap-2 text-muted-foreground">
            <Lock className="h-4 w-4" />
            {icon && <span className="flex items-center">{icon}</span>}
            {title}
          </CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="p-4 bg-muted/30 border border-muted rounded-lg text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            🔒 Available after {prerequisite}
          </p>
          {onScrollToPrerequisite && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onScrollToPrerequisite}
              className="text-xs"
            >
              <ArrowDown className="h-3 w-3 mr-1" />
              Jump to prerequisite
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
