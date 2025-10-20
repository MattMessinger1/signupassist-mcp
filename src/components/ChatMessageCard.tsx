import { ProviderConfirmationCard } from "./ProviderConfirmationCard";

export interface MessageCardData {
  type: "provider_confirmation";
  data: {
    name: string;
    location: string;
    orgRef?: string;
  };
}

interface ChatMessageCardProps {
  card: MessageCardData;
  onConfirm: (data: any) => void;
  onReject?: (data: any) => void;
}

export function ChatMessageCard({ card, onConfirm, onReject }: ChatMessageCardProps) {
  if (card.type === "provider_confirmation") {
    return (
      <ProviderConfirmationCard
        name={card.data.name}
        location={card.data.location}
        onConfirm={() => onConfirm(card.data)}
        onReject={onReject ? () => onReject(card.data) : undefined}
      />
    );
  }

  return null;
}
