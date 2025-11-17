export function detectNewProvider(userMessage: string, currentProviderName: string | null): boolean {
  if (!userMessage) return false;
  if (!currentProviderName) return false;

  // Normalize
  const msg = userMessage.toLowerCase();
  const cur = currentProviderName.toLowerCase();

  // If user message explicitly contains current provider, no change
  if (msg.includes(cur)) return false;

  // If message mentions a new org-like phrase, assume provider change.
  // Heuristic for org-like names: contains capitalized word(s), "center", "club", "academy", "school",
  // or multi-word proper nouns that are not the current provider.
  const orgIndicators = [
    "center",
    "club",
    "academy",
    "school",
    "ymca",
    "boys and girls",
    "anna maria",
    "middleton",
    "rec",
    "park district",
    "association",
    "institute"
  ];
  const hits = orgIndicators.some(ind => msg.includes(ind));

  if (hits) {
    // If it mentions something org-like but not current provider, treat as provider switch
    return true;
  }

  return false;
}
