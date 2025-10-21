import { ProviderConfirmationCard } from "./ProviderConfirmationCard";
import { MultipleProvidersCard } from "./MultipleProvidersCard";
import { LoginPromptCard } from "./LoginPromptCard";

export interface ProviderData {
  name: string;
  location: string;
  orgRef?: string;
}

export interface MessageCardData {
  type: "provider_confirmation" | "multiple_providers" | "connect_account";
  data: ProviderData | ProviderData[] | { provider: string; org_name: string; org_ref: string };
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

  if (card.type === "connect_account") {
    const data = card.data as { provider: string; org_name: string; org_ref: string };
    return (
      <LoginPromptCard
        provider={data.provider}
        orgName={data.org_name}
        orgRef={data.org_ref}
        onConnect={() => onConfirm(data)}
      />
    );
  }

  return null;
}
