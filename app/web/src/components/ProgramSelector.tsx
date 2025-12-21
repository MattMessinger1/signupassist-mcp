/**
 * ProgramSelector Component
 * 
 * Renders program cards organized by theme for the ChatGPT Apps SDK widget.
 * Uses shared core library for status detection and formatting.
 */

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/primitives';
import { 
  getStatusDisplay, 
  detectProgramRestrictions, 
  formatCaptionParts, 
  getButtonVariantForLabel,
  ProgramStatus 
} from '../lib/core/programStatus';
import { formatMoney } from '../lib/core/formatting';
import { COPY } from '../lib/core/copy';
import { tools } from '../lib/adapters/toolAdapter';

// ============ Types ============

interface CardAction {
  type: 'link' | 'postback';
  label: string;
  href?: string;
  payload?: Record<string, unknown>;
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
  payload: Record<string, unknown>;
}

export interface ProgramSelectorPayload {
  type: 'cards-grouped';
  groups: CardGroup[];
  cta?: {
    type: 'chips';
    options: CTAChip[];
  };
}

interface ProgramSelectorProps {
  payload: ProgramSelectorPayload;
  onSelect?: (programRef: string, orgRef: string, action: string) => void;
  onChipClick?: (payload: Record<string, unknown>) => void;
}

// ============ Helper Functions ============

const mapCategoryLabel = (title: string): string => {
  const labelMap: Record<string, string> = {
    'Races & Teams': 'Race Team & Events',
    'Other Programs': 'Other',
  };
  return labelMap[title] || title;
};

const extractPriceFromCaption = (caption: string): number | null => {
  const priceMatch = caption.match(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/);
  if (priceMatch) {
    return Math.round(parseFloat(priceMatch[1].replace(',', '')) * 100);
  }
  return null;
};

// ============ Sub-Components ============

interface StatusBadgeProps {
  status: string;
}

function StatusBadge({ status }: StatusBadgeProps) {
  const { variant, label } = getStatusDisplay(status);
  const variantStyles: Record<string, string> = {
    default: 'bg-secondary text-secondary-foreground',
    accent: 'bg-primary text-primary-foreground',
    warning: 'bg-amber-500/20 text-amber-700',
    destructive: 'bg-destructive/20 text-destructive',
    outline: 'border border-border text-muted-foreground',
  };
  
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${variantStyles[variant] || variantStyles.default}`}>
      {label}
    </span>
  );
}

interface PriceBadgeProps {
  priceCents: number;
}

function PriceBadge({ priceCents }: PriceBadgeProps) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
      {formatMoney(priceCents)}
    </span>
  );
}

interface RestrictionBadgeProps {
  reason: string;
}

function RestrictionBadge({ reason }: RestrictionBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-destructive/20 text-destructive">
      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
      {reason}
    </span>
  );
}

// ============ Main Component ============

export function ProgramSelector({ payload, onSelect, onChipClick }: ProgramSelectorProps) {
  const [selectedProgram, setSelectedProgram] = useState<string | null>(null);

  const handleAction = (action: CardAction, card: ProgramCard) => {
    const restriction = detectProgramRestrictions(
      card.body,
      card.caption,
      card.subtitle?.includes('Status:') ? card.subtitle.split('Status:')[1]?.trim() : undefined
    );

    if (action.type === 'link' && action.href) {
      window.open(action.href, '_blank', 'noopener,noreferrer');
    } else if (action.type === 'postback' && card.program_ref && card.org_ref) {
      setSelectedProgram(card.program_ref);
      
      const actionName = (action.payload?.intent as string) || 'select_program';
      onSelect?.(card.program_ref, card.org_ref, actionName);
    }
  };

  const handleChipClick = (chip: CTAChip) => {
    onChipClick?.(chip.payload);
  };

  // Filter out empty groups
  const visibleGroups = payload.groups.filter(group => group.cards && group.cards.length > 0);

  if (visibleGroups.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>No programs available at this time.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full">
      {visibleGroups.map((group, groupIdx) => (
        <div key={groupIdx} className="space-y-3">
          <h3 className="text-lg font-semibold text-foreground">
            {mapCategoryLabel(group.title)}
          </h3>
          
          <div className="grid gap-4 md:grid-cols-2">
            {group.cards
              .filter(card => !card.isHeader)
              .slice(0, 4)
              .map((card, cardIdx) => {
                const captionParts = card.caption ? formatCaptionParts(card.caption) : [];
                const restriction = detectProgramRestrictions(card.body, card.caption);
                const priceCents = card.caption ? extractPriceFromCaption(card.caption) : null;
                const isSelected = selectedProgram === card.program_ref;

                return (
                  <Card 
                    key={cardIdx} 
                    className={`flex flex-col transition-all ${
                      isSelected 
                        ? 'ring-2 ring-primary shadow-lg' 
                        : 'hover:shadow-md'
                    }`}
                  >
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">{card.title}</CardTitle>
                      {card.subtitle && (
                        <CardDescription className="text-sm">
                          {card.subtitle}
                        </CardDescription>
                      )}
                    </CardHeader>

                    <CardContent className="flex-1 pb-2">
                      {card.body && (
                        <p className="text-sm text-muted-foreground mb-3">
                          {card.body}
                        </p>
                      )}
                      
                      <div className="flex flex-wrap items-center gap-2">
                        {priceCents && <PriceBadge priceCents={priceCents} />}
                        
                        {captionParts
                          .filter(part => !part.startsWith('$'))
                          .map((part, i) => {
                            if (part.toLowerCase().startsWith('status:')) {
                              const statusValue = part.slice(7).trim();
                              return <StatusBadge key={i} status={statusValue} />;
                            }
                            return (
                              <span key={i} className="text-xs text-muted-foreground">
                                {part}
                              </span>
                            );
                          })}
                        
                        {restriction.isRestricted && (
                          <RestrictionBadge reason={restriction.reason || 'Restricted'} />
                        )}
                      </div>
                    </CardContent>

                    {card.actions && card.actions.length > 0 && (
                      <CardFooter className="pt-2 gap-2">
                        {card.actions.map((action, actionIdx) => {
                          const variant = getButtonVariantForLabel(action.label, undefined, action.type === 'link');
                          const buttonClass = variant === 'accent' 
                            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                            : variant === 'warning'
                            ? 'bg-amber-500 text-white hover:bg-amber-600'
                            : 'bg-secondary text-secondary-foreground hover:bg-secondary/80';
                          
                          return (
                            <button
                              key={actionIdx}
                              onClick={() => handleAction(action, card)}
                              className={`flex-1 inline-flex items-center justify-center px-4 py-2 rounded-md text-sm font-medium transition-colors ${buttonClass}`}
                            >
                              {action.label}
                              {action.type === 'link' && (
                                <svg className="ml-1 h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              )}
                            </button>
                          );
                        })}
                      </CardFooter>
                    )}
                  </Card>
                );
              })}
          </div>
        </div>
      ))}

      {payload.cta?.options && payload.cta.options.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-4 border-t border-border">
          {payload.cta.options.map((chip, idx) => (
            <button
              key={idx}
              onClick={() => handleChipClick(chip)}
              className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium border border-border bg-background hover:bg-secondary transition-colors"
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default ProgramSelector;
