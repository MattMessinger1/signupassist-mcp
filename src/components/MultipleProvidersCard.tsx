import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Building2, MapPin } from "lucide-react";
import { ProviderData } from "./ChatMessageCard";

interface MultipleProvidersCardProps {
  providers: ProviderData[];
  onSelect: (provider: ProviderData) => void;
  onNoneMatch?: () => void;
}

export function MultipleProvidersCard({ 
  providers, 
  onSelect,
  onNoneMatch 
}: MultipleProvidersCardProps) {
  return (
    <div className="space-y-3">
      {providers.map((provider, index) => (
        <Card 
          key={`${provider.orgRef || provider.name}-${index}`} 
          className="border-primary/20 bg-card hover:border-primary/40 transition-colors"
        >
          <CardHeader className="pb-3">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-lg">{provider.name}</CardTitle>
                <CardDescription className="flex items-center gap-1 mt-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {provider.location}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardFooter className="pt-0">
            <Button 
              onClick={() => onSelect(provider)} 
              className="w-full"
              size="sm"
            >
              Select this one
            </Button>
          </CardFooter>
        </Card>
      ))}

      {onNoneMatch && (
        <Button 
          onClick={onNoneMatch} 
          variant="outline" 
          className="w-full"
          size="sm"
        >
          None of these match
        </Button>
      )}
    </div>
  );
}
