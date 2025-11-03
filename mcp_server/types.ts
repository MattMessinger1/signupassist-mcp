export type Child = {
  id: string;
  name: string;
  birthdate?: string;
};

export type SessionContext = {
  userLocation?: { lat: number; lng: number };
  user_jwt?: string;
  provider?: { name: string; orgRef: string; source?: string; city?: string; state?: string };
  providerSearchResults?: any[];
  credential_id?: string;
  provider_cookies?: any[];
  loginCompleted?: boolean;
  step?: number;
  session_token?: string;      // persisted session
  discovery_retry_count?: number;
  mandate_jws?: string;
  mandate_id?: string;
  children?: Child[];
};
