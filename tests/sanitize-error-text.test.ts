import { describe, it, expect } from 'vitest';

/**
 * Sanitize error messages by removing PII
 */
function sanitizeErrorText(txt: string): string {
  if (!txt) return '';
  
  // Remove email addresses
  txt = txt.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}/g, '[EMAIL]');
  
  // Remove phone numbers (various formats)
  txt = txt.replace(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, '[PHONE]');
  txt = txt.replace(/\+?\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g, '[PHONE]');
  
  // Remove 13-19 digit runs (credit card numbers)
  txt = txt.replace(/\d{13,19}/g, '[CC]');
  
  return txt;
}

describe('sanitizeErrorText', () => {
  it('should redact email addresses', () => {
    const input = 'User john.doe@example.com already exists';
    const output = sanitizeErrorText(input);
    expect(output).toBe('User [EMAIL] already exists');
  });

  it('should redact multiple email addresses', () => {
    const input = 'Contact admin@site.com or support@help.org';
    const output = sanitizeErrorText(input);
    expect(output).toBe('Contact [EMAIL] or [EMAIL]');
  });

  it('should redact phone numbers in various formats', () => {
    const tests = [
      { input: 'Call 555-123-4567 for help', expected: 'Call [PHONE] for help' },
      { input: 'Phone: (555) 123-4567', expected: 'Phone: [PHONE]' },
      { input: 'Mobile 5551234567', expected: 'Mobile [PHONE]' },
      { input: 'Dial +1 555 123 4567', expected: 'Dial [PHONE]' },
      { input: '+44 20 1234 5678', expected: '[PHONE]' },
    ];

    tests.forEach(({ input, expected }) => {
      expect(sanitizeErrorText(input)).toBe(expected);
    });
  });

  it('should redact credit card-like numbers (13-19 digits)', () => {
    const tests = [
      { input: 'Card 4532015112830366 declined', expected: 'Card [CC] declined' },
      { input: 'Use card 5425233430109903', expected: 'Use card [CC]' },
      { input: 'Account 378282246310005 invalid', expected: 'Account [CC] invalid' },
      { input: 'Number 1234567890123 too short', expected: 'Number [CC] too short' }, // 13 digits
      { input: 'Number 12345678901234567890 too long', expected: 'Number [CC] too long' }, // 20 digits -> not redacted
    ];

    tests.forEach(({ input, expected }) => {
      expect(sanitizeErrorText(input)).toBe(expected);
    });
  });

  it('should handle multiple PII types in one string', () => {
    const input = 'User john@example.com with phone 555-123-4567 and card 4532015112830366 failed';
    const output = sanitizeErrorText(input);
    expect(output).toBe('User [EMAIL] with phone [PHONE] and card [CC] failed');
  });

  it('should return empty string for null/empty input', () => {
    expect(sanitizeErrorText('')).toBe('');
    expect(sanitizeErrorText(null as any)).toBe('');
    expect(sanitizeErrorText(undefined as any)).toBe('');
  });

  it('should not modify text without PII', () => {
    const input = 'Field is required';
    expect(sanitizeErrorText(input)).toBe('Field is required');
  });

  it('should preserve non-PII numbers', () => {
    const input = 'Expected 3 to 5 characters, got 12';
    expect(sanitizeErrorText(input)).toBe('Expected 3 to 5 characters, got 12');
  });
});
