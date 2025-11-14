/**
 * Auth - Credential handling and encryption
 */

import crypto from 'crypto';

export interface EncryptedCredentials {
  encrypted: string;
  iv: string;
  provider: string;
  userId: string;
  createdAt: Date;
}

export interface UserCredentials {
  email: string;
  password: string;
  paymentMethod?: {
    cardNumber: string;
    expiryDate: string;
    cvv: string;
    billingAddress: any;
  };
  metadata?: Record<string, any>;
}

export class AuthService {
  private readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';
  private readonly KEY_LENGTH = 32;
  private readonly IV_LENGTH = 12; // GCM mode uses 12 bytes for IV

  constructor(private encryptionKey: string) {
    if (!encryptionKey || encryptionKey.length < 32) {
      throw new Error('Encryption key must be at least 32 characters long');
    }
  }

  /**
   * Encrypt user credentials
   */
  encryptCredentials(credentials: UserCredentials, provider: string, userId: string): EncryptedCredentials {
    const key = crypto.scryptSync(this.encryptionKey, 'salt', this.KEY_LENGTH);
    const iv = crypto.randomBytes(this.IV_LENGTH);
    
    const cipher = crypto.createCipheriv(this.ENCRYPTION_ALGORITHM, key, iv);
    
    const credentialsString = JSON.stringify(credentials);
    let encrypted = cipher.update(credentialsString, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted: encrypted + ':' + authTag.toString('hex'),
      iv: iv.toString('hex'),
      provider,
      userId,
      createdAt: new Date()
    };
  }

  /**
   * Decrypt user credentials
   */
  decryptCredentials(encryptedCreds: EncryptedCredentials): UserCredentials {
    const key = crypto.scryptSync(this.encryptionKey, 'salt', this.KEY_LENGTH);
    const iv = Buffer.from(encryptedCreds.iv, 'hex');
    
    const [encryptedData, authTagHex] = encryptedCreds.encrypted.split(':');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(this.ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  }

  /**
   * Store encrypted credentials
   */
  async storeCredentials(credentials: UserCredentials, provider: string, userId: string): Promise<string> {
    const encrypted = this.encryptCredentials(credentials, provider, userId);
    
    // TODO: Store in secure database
    const credentialId = `cred_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`Stored encrypted credentials for user ${userId}, provider ${provider}`);
    
    return credentialId;
  }

  /**
   * Retrieve and decrypt credentials
   */
  async getCredentials(credentialId: string): Promise<UserCredentials> {
    // TODO: Retrieve from database
    throw new Error('Credential retrieval not implemented');
  }

  /**
   * Delete stored credentials
   */
  async deleteCredentials(credentialId: string): Promise<boolean> {
    // TODO: Delete from database
    console.log(`Deleted credentials ${credentialId}`);
    return true;
  }

  /**
   * Validate credentials format
   */
  validateCredentials(credentials: UserCredentials, provider: string): boolean {
    // Basic validation
    if (!credentials.email || !credentials.password) {
      return false;
    }

    // Provider-specific validation
    switch (provider) {
      case 'skiclubpro':
        // Add SkiClubPro specific validation
        return this.isValidEmail(credentials.email);
      
      case 'daysmart':
        // Add DaySmart specific validation
        return this.isValidEmail(credentials.email);
      
      case 'campminder':
        // Add CampMinder specific validation
        return this.isValidEmail(credentials.email);
      
      default:
        return false;
    }
  }

  /**
   * Basic email validation
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Generate secure credential ID
   */
  static generateCredentialId(): string {
    return `cred_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }
}