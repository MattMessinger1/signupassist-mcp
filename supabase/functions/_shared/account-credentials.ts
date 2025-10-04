/**
 * Custom error for credential validation failures
 */
export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialError';
  }
}

/**
 * Decrypted credential structure
 */
export interface DecryptedCredentials {
  email: string;
  password: string;
  [key: string]: any;
}

/**
 * Verify that decrypted credentials are valid
 * Checks basic format to ensure decryption worked correctly
 */
export function verifyDecryption(credentials: any): credentials is DecryptedCredentials {
  // Check if credentials object exists
  if (!credentials || typeof credentials !== 'object') {
    throw new CredentialError('Decryption failed validation: invalid credentials format');
  }

  // Check email format
  if (typeof credentials.email !== 'string' || !credentials.email.includes('@')) {
    throw new CredentialError('Decryption failed validation: invalid email format');
  }

  // Check password length
  if (typeof credentials.password !== 'string' || credentials.password.length <= 3) {
    throw new CredentialError('Decryption failed validation: password too short or invalid');
  }

  return true;
}

/**
 * Sanitize credentials for logging (remove sensitive data)
 */
export function sanitizeCredentialsForLog(credentials: any): Record<string, any> {
  if (!credentials || typeof credentials !== 'object') {
    return { error: 'Invalid credentials object' };
  }

  return {
    email: credentials.email ? `${credentials.email.substring(0, 3)}***` : 'missing',
    passwordLength: credentials.password?.length || 0,
    hasEmail: !!credentials.email,
    hasPassword: !!credentials.password
  };
}
