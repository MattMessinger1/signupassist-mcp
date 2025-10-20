import { MessageCardData } from "@/components/ChatMessageCard";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  card?: MessageCardData;
  payload?: {
    type: string;
    [key: string]: any;
  };
  metadata?: Record<string, any>;
}

export interface DisambiguationContext {
  type: "single_match" | "multiple_matches" | "no_match";
  searchQuery: string;
  providers?: Array<{
    name: string;
    city?: string;
    address?: string;
    orgRef?: string;
    source?: "local" | "google";
  }>;
  confirmedProvider?: any;
}
