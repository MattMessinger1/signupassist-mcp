/**
 * Tone Validation for SignupAssist
 * Validates that AI responses follow Design DNA guidelines
 */

export interface ToneValidation {
  emojiCount: number;
  hasConfirmation: boolean;
  hasSecurityNote: boolean;
  readingLevel: number; // Flesch-Kincaid grade (target: 6-8)
  issues: string[];
}

export interface ToneContext {
  requiresConfirmation?: boolean; // Is this a payment/registration step?
  isSecuritySensitive?: boolean;  // Is this login/payment related?
  stepName?: string;
}

/**
 * Validates message tone against Design DNA rules
 */
export function validateTone(message: string, context: ToneContext = {}): ToneValidation {
  const issues: string[] = [];
  
  // Count emoji
  const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/gu;
  const emojiCount = (message.match(emojiRegex) || []).length;
  
  if (emojiCount > 2) {
    issues.push(`Too many emoji: ${emojiCount} (max: 2)`);
  }
  
  // Check for confirmation patterns before critical actions
  const confirmationPatterns = [
    /shall i proceed/i,
    /would you like me to/i,
    /ready to/i,
    /\bconfirm\b/i,
    /is that correct/i,
    /does that work/i,
  ];
  const hasConfirmation = confirmationPatterns.some(pattern => pattern.test(message));
  
  if (context.requiresConfirmation && !hasConfirmation) {
    issues.push('Missing confirmation before critical action (payment/registration)');
  }
  
  // Check for security note on sensitive steps
  const securityKeywords = [
    'secure',
    'never store',
    'provider',
    'encrypted',
    'credentials',
    'card data',
    'stays with',
  ];
  const hasSecurityNote = securityKeywords.some(keyword => 
    message.toLowerCase().includes(keyword)
  );
  
  if (context.isSecuritySensitive && !hasSecurityNote) {
    issues.push('Missing security note on sensitive step (login/payment)');
  }
  
  // Rough readability check (word length and sentence complexity)
  const words = message.split(/\s+/);
  const sentences = message.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const avgWordsPerSentence = words.length / Math.max(sentences.length, 1);
  const avgCharsPerWord = words.reduce((sum, w) => sum + w.length, 0) / Math.max(words.length, 1);
  
  // Simplified Flesch-Kincaid: higher = harder to read
  // Target: 6-8 grade level (simple, clear)
  const readingLevel = Math.max(1, Math.min(12, 
    0.39 * avgWordsPerSentence + 11.8 * (avgCharsPerWord / 5) - 15.59
  ));
  
  if (readingLevel > 9) {
    issues.push(`Reading level too high: ${readingLevel.toFixed(1)} (target: 6-8)`);
  }
  
  // Check for overly long sentences
  if (avgWordsPerSentence > 20) {
    issues.push(`Sentences too long: ${avgWordsPerSentence.toFixed(1)} words/sentence (max: 20)`);
  }
  
  // Check for jargon or complex words
  const jargonWords = [
    'utilize',
    'facilitate',
    'implement',
    'subsequently',
    'aforementioned',
    'commence',
    'endeavor',
  ];
  const foundJargon = jargonWords.filter(jargon => 
    message.toLowerCase().includes(jargon)
  );
  
  if (foundJargon.length > 0) {
    issues.push(`Jargon detected: ${foundJargon.join(', ')} (use simpler words)`);
  }
  
  return {
    emojiCount,
    hasConfirmation: context.requiresConfirmation ? hasConfirmation : true,
    hasSecurityNote: context.isSecuritySensitive ? hasSecurityNote : true,
    readingLevel,
    issues,
  };
}

/**
 * Determines tone context based on message content and flow state
 */
export function determineToneContext(
  message: string,
  currentStep?: string
): ToneContext {
  const lowerMessage = message.toLowerCase();
  
  // Check if this is a payment or registration step
  const isPaymentOrRegistration = 
    /\b(payment|pay|charge|register|enroll|confirm|submit)\b/i.test(lowerMessage) ||
    currentStep === 'payment' ||
    currentStep === 'registration' ||
    currentStep === 'confirmation';
  
  // Check if this is a login or security-sensitive step
  const isLoginOrSecurity = 
    /\b(login|password|credential|connect|account|secure)\b/i.test(lowerMessage) ||
    currentStep === 'login' ||
    currentStep === 'connect_account' ||
    isPaymentOrRegistration;
  
  return {
    requiresConfirmation: isPaymentOrRegistration,
    isSecuritySensitive: isLoginOrSecurity,
    stepName: currentStep,
  };
}

/**
 * Formats tone validation results for display
 */
export function formatToneIssues(validation: ToneValidation): string {
  if (validation.issues.length === 0) {
    return '✅ Tone validation passed';
  }
  
  return `⚠️ Tone issues:\n${validation.issues.map(i => `  • ${i}`).join('\n')}`;
}
