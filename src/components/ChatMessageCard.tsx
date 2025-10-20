import { ProviderConfirmationCard } from "./ProviderConfirmationCard";
import { MultipleProvidersCard } from "./MultipleProvidersCard";

export interface ProviderData {
  name: string;
  location: string;
  orgRef?: string;
}

export interface MessageCardData {
  type: "provider_confirmation" | "multiple_providers";
  data: ProviderData | ProviderData[];
}

interface ChatMessageCardProps {
  card: MessageCardData;
  onConfirm: (data: any) => void;
  onReject?: (data: any) => void;
}

export function ChatMessageCard({ card, onConfirm, onReject }: ChatMessageCardProps) {
  if (card.type === "provider_confirmation") {
    const data = card.data as ProviderData;
    return (
      <ProviderConfirmationCard
        name={data.name}
        location={data.location}
        onConfirm={() => onConfirm(data)}
        onReject={onReject ? () => onReject(data) : undefined}
      />
    );
  }

  if (card.type === "multiple_providers") {
    const providers = card.data as ProviderData[];
    return (
      <MultipleProvidersCard
        providers={providers}
        onSelect={(provider) => onConfirm(provider)}
        onNoneMatch={onReject ? () => onReject({}) : undefined}
      />
    );
  }

  return null;
}
