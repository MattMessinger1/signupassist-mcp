import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Building2, MapPin } from "lucide-react";

interface ProviderConfirmationCardProps {
  name: string;
  location: string;
  onConfirm: () => void;
  onReject?: () => void;
}

export function ProviderConfirmationCard({ 
  name, 
  location, 
  onConfirm,
  onReject 
}: ProviderConfirmationCardProps) {
  return (
    <Card className="border-primary/20 bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-lg">{name}</CardTitle>
            <CardDescription className="flex items-center gap-1 mt-1">
              <MapPin className="h-3.5 w-3.5" />
              {location}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardFooter className="flex gap-2 pt-2">
        <Button 
          onClick={onConfirm} 
          className="flex-1"
          size="sm"
        >
          Yes
        </Button>
        {onReject && (
          <Button 
            onClick={onReject} 
            variant="outline" 
            className="flex-1"
            size="sm"
          >
            Show me Others
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
