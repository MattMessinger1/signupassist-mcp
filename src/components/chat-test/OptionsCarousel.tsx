import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { Button } from "@/components/ui/button";

interface Option {
  id: string;
  title: string;
  description?: string;
  imageUrl?: string;
}

interface OptionsCarouselProps {
  options: Option[];
  onSelect: (option: Option) => void;
}

export function OptionsCarousel({ options, onSelect }: OptionsCarouselProps) {
  return (
    <div className="mt-3 px-8">
      <Carousel className="w-full">
        <CarouselContent>
          {options.map((option) => (
            <CarouselItem key={option.id} className="md:basis-1/2 lg:basis-1/3">
              <Card className="border-muted hover:border-primary/40 transition-colors">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{option.title}</CardTitle>
                  {option.description && (
                    <CardDescription className="text-sm">{option.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent className="pb-3">
                  <Button 
                    onClick={() => onSelect(option)} 
                    size="sm" 
                    variant="outline"
                    className="w-full"
                  >
                    Select
                  </Button>
                </CardContent>
              </Card>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious />
        <CarouselNext />
      </Carousel>
    </div>
  );
}
