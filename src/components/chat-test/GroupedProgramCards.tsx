/**
 * GroupedProgramCards Component
 * 
 * Renders program cards organized by theme (Lessons, Camps, Race Team).
 * Supports the UI_PAYLOAD__GROUPED_CARDS format from the orchestrator.
 */

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Info } from "lucide-react";

interface CardAction {
  type: "link" | "postback";
  label: string;
  href?: string;
  payload?: any;
}

interface ProgramCard {
  title: string;
  subtitle?: string;
  caption?: string;
  body?: string;
  actions: CardAction[];
  isHeader?: boolean;
  program_ref?: string;
  org_ref?: string;
}

interface CardGroup {
  title: string;
  cards: ProgramCard[];
}

interface CTAChip {
  label: string;
  payload: any;
}

interface GroupedCardsPayload {
  type: "cards-grouped";
  groups: CardGroup[];
  cta?: {
    type: "chips";
    options: CTAChip[];
  };
}

interface GroupedProgramCardsProps {
  payload: GroupedCardsPayload;
  onAction?: (action: string, data: any) => void;
}

export function GroupedProgramCards({ payload, onAction }: GroupedProgramCardsProps) {
  const handleAction = (action: CardAction, card: ProgramCard) => {
    if (action.type === "link" && action.href) {
      window.open(action.href, "_blank");
    } else if (action.type === "postback" && action.payload && onAction) {
      // Enhance payload with card metadata for view_program action
      const enhancedPayload = {
        ...action.payload,
        program_ref: card.program_ref,
        org_ref: card.org_ref,
      };
      onAction("postback", enhancedPayload);
    }
  };
  
  // Map category labels to design labels
  const mapCategoryLabel = (title: string): string => {
    const labelMap: Record<string, string> = {
      "Races & Teams": "Race Team & Events",
      "Other Programs": "Other"
    };
    return labelMap[title] || title;
  };

  const handleChipClick = (chip: CTAChip) => {
    if (onAction) {
      onAction("chip_click", chip.payload);
    }
  };

  // Filter out empty groups
  const visibleGroups = payload.groups.filter(group => group.cards && group.cards.length > 0);

  if (visibleGroups.length === 0) {
    return null;
  }

  return (
    <div className="space-y-6 w-full">
      {visibleGroups.map((group, groupIdx) => (
        <div key={groupIdx} className="space-y-3">
          <h3 className="text-lg font-semibold text-foreground">{mapCategoryLabel(group.title)}</h3>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {group.cards.slice(0, 4).map((card, cardIdx) => {
              // Skip header cards in rendering
              if (card.isHeader) {
                return null;
              }
              
              return (
                <Card key={cardIdx} className="flex flex-col hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <CardTitle className="text-base">{card.title}</CardTitle>
                    {card.subtitle && (
                      <CardDescription className="text-sm">
                        {card.subtitle}
                      </CardDescription>
                    )}
                  </CardHeader>
                  
                  {(card.body || card.caption) && (
                    <CardContent className="flex-1">
                      {card.body && (
                        <p className="text-sm text-muted-foreground mb-2">{card.body}</p>
                      )}
                      {card.caption && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {card.caption.split('•').map((part, i) => (
                            <span key={i} className="flex items-center gap-1">
                              {i > 0 && <span>•</span>}
                              {part.trim().startsWith('$') ? (
                                <Badge variant="secondary">{part.trim()}</Badge>
                              ) : (
                                <span>{part.trim()}</span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  )}
                  
                  {!card.isHeader && card.actions && card.actions.length > 0 && (
                    <CardFooter className="flex gap-2">
                      {card.actions.map((action, actionIdx) => (
                        <Button
                          key={actionIdx}
                          variant={action.type === "link" ? "default" : "outline"}
                          size="sm"
                          onClick={() => handleAction(action, card)}
                          className="flex-1"
                        >
                          {action.type === "link" ? (
                            <>
                              {action.label}
                              <ExternalLink className="ml-1 h-3 w-3" />
                            </>
                          ) : (
                            <>
                              <Info className="mr-1 h-3 w-3" />
                              {action.label}
                            </>
                          )}
                        </Button>
                      ))}
                    </CardFooter>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      ))}

      {payload.cta && payload.cta.options && payload.cta.options.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-4 border-t">
          {payload.cta.options.map((chip, idx) => (
            <Button
              key={idx}
              variant="outline"
              size="sm"
              onClick={() => handleChipClick(chip)}
            >
              {chip.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
